// #ps-export=<port>-<code>: the desktop game (Settings → Account) asks for this browser's save.
// The website has no code for it, so this extension does it. A content script's fetch carries the page's Origin
// (https://pokesurvivor.com), the only one the game accepts.
(function () {
  const m = /^#ps-export=(\d{2,5})-([0-9a-f]{32})$/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  async function send() {
    const save = psPick('Send to the desktop game');
    if (!save) return;
    try {
      const r = await fetch('http://127.0.0.1:' + m[1] + '/' + m[2], { method: 'POST', headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ ps: 'save', save }) });
      alert(r.ok ? 'Save sent: go back to the game.' : 'The game did not accept it (' + r.status + ').');
    } catch (e) { alert('Could not send it. Is the game still open?'); }
  }
  // ponytail: 3 s so the website can refresh the cloud copy (ps.cloud.*) before it is read.
  setTimeout(send, 3000);
})();
