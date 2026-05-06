"""
ArchitectureV1 — backend relay
WebSocket coordination between Agents (controlled PCs) and Controllers (the desktop UI).

Two WS endpoints:
  /api/ws/agent       — an agent connects, registers a PC, receives commands, streams frames
  /api/ws/controller  — the desktop app connects, lists PCs, subscribes to a PC, sends commands
"""
import asyncio
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Set

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, WebSocket, WebSocketDisconnect
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
log = logging.getLogger("arch.relay")

app = FastAPI(title="ArchitectureV1 Relay")
api = APIRouter(prefix="/api")


# --------------------------- Connection registry ---------------------------

class Agent:
    def __init__(self, ws: WebSocket, pc_id: str, info: Dict[str, Any]):
        self.ws = ws
        self.pc_id = pc_id
        self.info = info  # hostname, os, browsers
        self.connected_at = datetime.now(timezone.utc).isoformat()
        self.streaming_subs: Set[str] = set()  # set of controller ids subscribed for frames

    def public(self) -> Dict[str, Any]:
        return {
            "pc_id": self.pc_id,
            "hostname": self.info.get("hostname", "unknown"),
            "os": self.info.get("os", "unknown"),
            "browsers": self.info.get("browsers", []),
            "online": True,
            "connected_at": self.connected_at,
        }


class Controller:
    def __init__(self, ws: WebSocket, controller_id: str):
        self.ws = ws
        self.controller_id = controller_id
        self.watching: Optional[str] = None  # pc_id


class Hub:
    def __init__(self):
        self.agents: Dict[str, Agent] = {}
        self.controllers: Dict[str, Controller] = {}
        self.lock = asyncio.Lock()

    async def add_agent(self, agent: Agent):
        async with self.lock:
            # If a previous connection exists for the same pc_id, drop it
            existing = self.agents.get(agent.pc_id)
            if existing and existing.ws is not agent.ws:
                try:
                    await existing.ws.close()
                except Exception:
                    pass
            self.agents[agent.pc_id] = agent
        await self.broadcast_pcs()

    async def remove_agent(self, pc_id: str):
        async with self.lock:
            self.agents.pop(pc_id, None)
        await self.broadcast_pcs()
        # Notify any controllers watching this PC
        for c in list(self.controllers.values()):
            if c.watching == pc_id:
                await self._safe_send(c.ws, {"type": "pc_offline", "pc_id": pc_id})

    async def add_controller(self, controller: Controller):
        async with self.lock:
            self.controllers[controller.controller_id] = controller
        # Send current PC list immediately
        await self._safe_send(controller.ws, {"type": "pcs", "pcs": [a.public() for a in self.agents.values()]})

    async def remove_controller(self, controller_id: str):
        async with self.lock:
            c = self.controllers.pop(controller_id, None)
        if not c:
            return
        # If this controller was streaming, tell agent to stop if no other subs remain
        if c.watching:
            agent = self.agents.get(c.watching)
            if agent:
                agent.streaming_subs.discard(controller_id)
                if not agent.streaming_subs:
                    await self._safe_send(agent.ws, {"type": "stop_stream"})

    async def broadcast_pcs(self):
        payload = {"type": "pcs", "pcs": [a.public() for a in self.agents.values()]}
        for c in list(self.controllers.values()):
            await self._safe_send(c.ws, payload)

    async def subscribe(self, controller: Controller, pc_id: Optional[str]):
        # Unsubscribe previous
        if controller.watching and controller.watching != pc_id:
            prev = self.agents.get(controller.watching)
            if prev:
                prev.streaming_subs.discard(controller.controller_id)
                if not prev.streaming_subs:
                    await self._safe_send(prev.ws, {"type": "stop_stream"})
        controller.watching = pc_id
        if pc_id is None:
            return
        agent = self.agents.get(pc_id)
        if not agent:
            await self._safe_send(controller.ws, {"type": "pc_offline", "pc_id": pc_id})
            return
        agent.streaming_subs.add(controller.controller_id)
        await self._safe_send(agent.ws, {"type": "start_stream"})

    async def relay_open(self, pc_id: str, url: str, browser_path: Optional[str], requester_id: str):
        agent = self.agents.get(pc_id)
        if not agent:
            ctrl = self.controllers.get(requester_id)
            if ctrl:
                await self._safe_send(ctrl.ws, {"type": "open_result", "ok": False, "error": "PC offline"})
            return
        await self._safe_send(agent.ws, {
            "type": "open_url",
            "url": url,
            "browser_path": browser_path,
            "requester_id": requester_id,
        })

    async def relay_frame(self, pc_id: str, frame: str, encoding: str = "png"):
        agent = self.agents.get(pc_id)
        if not agent:
            return
        msg = {"type": "frame", "pc_id": pc_id, "data": frame, "encoding": encoding}
        for cid in list(agent.streaming_subs):
            ctrl = self.controllers.get(cid)
            if ctrl:
                await self._safe_send(ctrl.ws, msg)

    async def relay_open_result(self, requester_id: str, ok: bool, error: Optional[str], url: Optional[str]):
        ctrl = self.controllers.get(requester_id)
        if ctrl:
            await self._safe_send(ctrl.ws, {"type": "open_result", "ok": ok, "error": error, "url": url})

    async def relay_get_history(self, pc_id: str, browser_icon: str, kind: str, limit: int, request_id: str, requester_id: str):
        agent = self.agents.get(pc_id)
        if not agent:
            ctrl = self.controllers.get(requester_id)
            if ctrl:
                await self._safe_send(ctrl.ws, {"type": "history_result", "request_id": request_id, "kind": kind, "ok": False, "error": "PC offline"})
            return
        await self._safe_send(agent.ws, {
            "type": "get_history",
            "browser_icon": browser_icon,
            "kind": kind,
            "limit": limit,
            "request_id": request_id,
            "requester_id": requester_id,
        })

    async def relay_history_result(self, requester_id: str, request_id: str, kind: str, ok: bool, entries, error: Optional[str]):
        ctrl = self.controllers.get(requester_id)
        if ctrl:
            await self._safe_send(ctrl.ws, {
                "type": "history_result",
                "request_id": request_id,
                "kind": kind,
                "ok": ok,
                "entries": entries or [],
                "error": error,
            })

    @staticmethod
    async def _safe_send(ws: WebSocket, payload: Dict[str, Any]):
        try:
            await ws.send_json(payload)
        except Exception:
            pass


hub = Hub()


# --------------------------- REST: list PCs ---------------------------

@api.get("/")
async def root():
    return {"app": "ArchitectureV1 Relay", "agents": len(hub.agents), "controllers": len(hub.controllers)}


@api.get("/pcs")
async def list_pcs():
    return {"pcs": [a.public() for a in hub.agents.values()]}


# --------------------------- WS: agent ---------------------------

@app.websocket("/api/ws/agent")
async def ws_agent(ws: WebSocket):
    await ws.accept()
    pc_id: Optional[str] = None
    try:
        # First message must be register
        first = await ws.receive_json()
        if first.get("type") != "register" or not first.get("pc_id"):
            await ws.send_json({"type": "error", "error": "expected register message"})
            await ws.close()
            return

        pc_id = str(first["pc_id"])
        info = {
            "hostname": first.get("hostname", "unknown"),
            "os": first.get("os", "unknown"),
            "browsers": first.get("browsers", []),
        }
        agent = Agent(ws=ws, pc_id=pc_id, info=info)
        await hub.add_agent(agent)
        log.info("agent connected pc_id=%s host=%s", pc_id, info["hostname"])

        await ws.send_json({"type": "registered", "pc_id": pc_id})

        while True:
            msg = await ws.receive_json()
            t = msg.get("type")
            if t == "frame":
                await hub.relay_frame(pc_id, msg.get("data", ""), msg.get("encoding", "png"))
            elif t == "open_result":
                await hub.relay_open_result(
                    msg.get("requester_id", ""),
                    bool(msg.get("ok")),
                    msg.get("error"),
                    msg.get("url"),
                )
            elif t == "history_result":
                await hub.relay_history_result(
                    msg.get("requester_id", ""),
                    msg.get("request_id", ""),
                    msg.get("kind", "history"),
                    bool(msg.get("ok")),
                    msg.get("entries", []),
                    msg.get("error"),
                )
            elif t == "browsers_update":
                a = hub.agents.get(pc_id)
                if a:
                    a.info["browsers"] = msg.get("browsers", [])
                    await hub.broadcast_pcs()
            elif t == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning("agent ws error: %s", e)
    finally:
        if pc_id:
            await hub.remove_agent(pc_id)
            log.info("agent disconnected pc_id=%s", pc_id)


# --------------------------- WS: controller ---------------------------

@app.websocket("/api/ws/controller")
async def ws_controller(ws: WebSocket):
    await ws.accept()
    import uuid
    controller_id = uuid.uuid4().hex
    controller = Controller(ws=ws, controller_id=controller_id)
    log.info("controller connected id=%s", controller_id)
    try:
        await ws.send_json({"type": "hello", "controller_id": controller_id})
        await hub.add_controller(controller)
        while True:
            msg = await ws.receive_json()
            t = msg.get("type")
            if t == "subscribe":
                await hub.subscribe(controller, msg.get("pc_id"))
            elif t == "list_pcs":
                await ws.send_json({"type": "pcs", "pcs": [a.public() for a in hub.agents.values()]})
            elif t == "open_url":
                await hub.relay_open(
                    msg.get("pc_id", ""),
                    msg.get("url", ""),
                    msg.get("browser_path"),
                    controller_id,
                )
            elif t == "get_history":
                await hub.relay_get_history(
                    msg.get("pc_id", ""),
                    msg.get("browser_icon", ""),
                    msg.get("kind", "history"),
                    int(msg.get("limit", 200)),
                    msg.get("request_id", ""),
                    controller_id,
                )
            elif t == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning("controller ws error: %s", e)
    finally:
        await hub.remove_controller(controller_id)
        log.info("controller disconnected id=%s", controller_id)


# --------------------------- App wiring ---------------------------

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
