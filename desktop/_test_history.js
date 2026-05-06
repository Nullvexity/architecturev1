// Functional test of history.js: builds a fake Chrome profile + Firefox places.sqlite,
// then exercises all 3 kinds (history/downloads/bookmarks) for both engines.
const fs = require('fs');
const path = require('path');
const os = require('os');

(async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: (f) => require.resolve('sql.js/dist/' + f) });

  // ----- Build fake Chrome profile -----
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-test-'));
  const chromeRoot = path.join(fakeRoot, 'chrome-userdata');
  const profileDir = path.join(chromeRoot, 'Default');
  fs.mkdirSync(profileDir, { recursive: true });

  // History SQLite
  const histDb = new SQL.Database();
  histDb.run('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INT, last_visit_time INT)');
  histDb.run('CREATE TABLE downloads (id INTEGER PRIMARY KEY, target_path TEXT, start_time INT, received_bytes INT, total_bytes INT, state INT, mime_type TEXT)');
  histDb.run('CREATE TABLE downloads_url_chains (id INT, chain_index INT, url TEXT)');
  // Insert urls
  const chromeT = (ms) => (ms + 11644473600000) * 1000; // ms→μs since 1601
  histDb.run("INSERT INTO urls VALUES (1, 'https://example.com', 'Example', 5, " + chromeT(Date.now() - 60_000) + ")");
  histDb.run("INSERT INTO urls VALUES (2, 'https://github.com', 'GitHub', 12, " + chromeT(Date.now() - 30_000) + ")");
  // Insert downloads
  histDb.run("INSERT INTO downloads VALUES (10, 'C:\\\\Users\\\\u\\\\Downloads\\\\report.pdf', " + chromeT(Date.now() - 300_000) + ", 1048576, 1048576, 1, 'application/pdf')");
  histDb.run("INSERT INTO downloads_url_chains VALUES (10, 0, 'https://files.example.com/r1')");
  histDb.run("INSERT INTO downloads_url_chains VALUES (10, 1, 'https://files.example.com/report.pdf')");
  histDb.run("INSERT INTO downloads VALUES (11, 'C:\\\\Users\\\\u\\\\Downloads\\\\image.png', " + chromeT(Date.now() - 200_000) + ", 51200, 102400, 2, 'image/png')");
  histDb.run("INSERT INTO downloads_url_chains VALUES (11, 0, 'https://img.example.com/photo.png')");
  fs.writeFileSync(path.join(profileDir, 'History'), Buffer.from(histDb.export()));
  histDb.close();

  // Bookmarks JSON
  const bookmarks = {
    roots: {
      bookmark_bar: {
        children: [
          { type: 'url', name: 'Google', url: 'https://google.com', date_added: String((Date.now() - 86400_000 + 11644473600000) * 1000) },
          {
            type: 'folder', name: 'Dev',
            children: [
              { type: 'url', name: 'GitHub', url: 'https://github.com', date_added: String((Date.now() - 3600_000 + 11644473600000) * 1000) },
              { type: 'url', name: 'StackOverflow', url: 'https://stackoverflow.com', date_added: String((Date.now() - 7200_000 + 11644473600000) * 1000) },
            ],
          },
        ],
      },
      other: { children: [] },
      synced: { children: [] },
    },
  };
  fs.writeFileSync(path.join(profileDir, 'Bookmarks'), JSON.stringify(bookmarks));

  // ----- Build fake Firefox profile -----
  const ffRoot = path.join(fakeRoot, 'firefox-profiles');
  const ffProfile = path.join(ffRoot, 'abc123.default');
  fs.mkdirSync(ffProfile, { recursive: true });
  const ffDb = new SQL.Database();
  ffDb.run('CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INT, last_visit_date INT)');
  ffDb.run('CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INT, fk INT, parent INT, title TEXT, dateAdded INT)');
  ffDb.run('CREATE TABLE moz_annos (id INTEGER PRIMARY KEY, place_id INT, anno_attribute_id INT, content TEXT)');
  ffDb.run('CREATE TABLE moz_anno_attributes (id INTEGER PRIMARY KEY, name TEXT)');

  // Insert places
  const ffT = (ms) => ms * 1000;
  ffDb.run(`INSERT INTO moz_places VALUES (1, 'https://mozilla.org', 'Mozilla', 3, ${ffT(Date.now() - 60_000)})`);
  ffDb.run(`INSERT INTO moz_places VALUES (2, 'https://duckduckgo.com', 'DuckDuckGo', 8, ${ffT(Date.now() - 30_000)})`);
  ffDb.run(`INSERT INTO moz_places VALUES (3, 'https://firefox.com/dl/file.zip', 'file.zip', 1, ${ffT(Date.now() - 90_000)})`);
  // Bookmarks: type 1=bookmark, parent points to a folder
  ffDb.run(`INSERT INTO moz_bookmarks VALUES (1, 2, NULL, 0, 'Toolbar', ${Date.now() * 1000})`);
  ffDb.run(`INSERT INTO moz_bookmarks VALUES (2, 1, 1, 1, 'Mozilla Home', ${Date.now() * 1000})`);
  ffDb.run(`INSERT INTO moz_bookmarks VALUES (3, 1, 2, 1, 'DDG', ${(Date.now() - 60_000) * 1000})`);
  // Downloads via annotation
  ffDb.run(`INSERT INTO moz_anno_attributes VALUES (1, 'downloads/destinationFileURI')`);
  ffDb.run(`INSERT INTO moz_annos VALUES (1, 3, 1, 'file:///home/u/Downloads/file.zip')`);
  fs.writeFileSync(path.join(ffProfile, 'places.sqlite'), Buffer.from(ffDb.export()));
  ffDb.close();

  // Patch homedir + history.js path resolution by setting HOME
  // We need history.js to look at our fake locations. Easiest: monkey-patch os.homedir
  // and set process.platform to 'linux' for predictable paths. Then place our fake
  // structures at the expected locations.

  // Reset modules cache, set HOME env to fakeRoot, then require history.js fresh
  process.env.HOME = fakeRoot;

  // Build expected layouts:
  // Linux Chrome: $HOME/.config/google-chrome/Default
  fs.mkdirSync(path.join(fakeRoot, '.config'), { recursive: true });
  fs.symlinkSync(chromeRoot, path.join(fakeRoot, '.config', 'google-chrome'));
  // Linux Firefox: $HOME/.mozilla/firefox/<profile>
  fs.mkdirSync(path.join(fakeRoot, '.mozilla'), { recursive: true });
  fs.symlinkSync(ffRoot, path.join(fakeRoot, '.mozilla', 'firefox'));

  // Force os.homedir to return fakeRoot
  const realHomedir = os.homedir;
  os.homedir = () => fakeRoot;

  // Now load history.js
  delete require.cache[require.resolve('/app/desktop/history.js')];
  const { getBrowserData } = require('/app/desktop/history.js');

  // Test 1: Chrome history
  const ch = await getBrowserData({ icon: 'chrome', kind: 'history', limit: 50 });
  console.log('chrome history rows:', ch.length, '— sample:', ch[0]);
  if (ch.length !== 2) throw new Error('expected 2 history rows');
  if (!ch[0].title) throw new Error('missing title');

  // Test 2: Chrome downloads (final URL via chain) - sorted DESC, image.png is newer
  const cd = await getBrowserData({ icon: 'chrome', kind: 'downloads', limit: 50 });
  console.log('chrome downloads rows:', cd.length);
  if (cd.length !== 2) throw new Error('expected 2 downloads');
  // Check the entry with chain redirects (id=10 / report.pdf)
  const reportRow = cd.find(d => d.file_name === 'report.pdf');
  if (!reportRow) throw new Error('report.pdf row missing');
  if (reportRow.url !== 'https://files.example.com/report.pdf') throw new Error('expected final-redirect URL, got: ' + reportRow.url);
  if (reportRow.state !== 'COMPLETE') throw new Error('expected COMPLETE state, got ' + reportRow.state);
  const imgRow = cd.find(d => d.file_name === 'image.png');
  if (!imgRow || imgRow.state !== 'CANCELLED') throw new Error('expected CANCELLED for image.png');
  if (imgRow.total_bytes !== 102400) throw new Error('expected total_bytes 102400');

  // Test 3: Chrome bookmarks
  const cb = await getBrowserData({ icon: 'chrome', kind: 'bookmarks', limit: 50 });
  console.log('chrome bookmarks rows:', cb.length, '— sample:', cb[0]);
  if (cb.length !== 3) throw new Error('expected 3 bookmarks');
  const ghBm = cb.find(b => b.url === 'https://github.com');
  if (!ghBm) throw new Error('GitHub bookmark missing');
  if (!ghBm.folder_path.includes('Dev')) throw new Error('expected folder path with Dev, got: ' + ghBm.folder_path);

  // Test 4: Firefox history
  const fh = await getBrowserData({ icon: 'firefox', kind: 'history', limit: 50 });
  console.log('firefox history rows:', fh.length, '— sample:', fh[0]);
  if (fh.length !== 3) throw new Error('expected 3 firefox history');

  // Test 5: Firefox downloads
  const fd = await getBrowserData({ icon: 'firefox', kind: 'downloads', limit: 50 });
  console.log('firefox downloads rows:', fd.length, '— sample:', fd[0]);
  if (fd.length !== 1) throw new Error('expected 1 firefox download');
  if (!fd[0].file_path.includes('file.zip')) throw new Error('expected file.zip path');

  // Test 6: Firefox bookmarks
  const fb = await getBrowserData({ icon: 'firefox', kind: 'bookmarks', limit: 50 });
  console.log('firefox bookmarks rows:', fb.length, '— sample:', fb[0]);
  if (fb.length !== 2) throw new Error('expected 2 firefox bookmarks');
  if (!fb[0].folder_path) throw new Error('expected folder_path on firefox bookmark');

  os.homedir = realHomedir;
  // cleanup
  try { fs.rmSync(fakeRoot, { recursive: true, force: true }); } catch (e) {}
  console.log('ALL_KIND_TESTS_PASSED');
})().catch(e => { console.error('FAIL:', e.stack || e); process.exit(1); });
