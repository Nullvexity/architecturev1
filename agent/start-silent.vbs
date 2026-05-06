' ArchitectureV1 Agent — silent launcher (Windows)
' Double-click to start the agent in the background with no console window.
Set WshShell = CreateObject("WScript.Shell")
strDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strDir
WshShell.Run "cmd /c node """ & strDir & "\agent.js""", 0, False
