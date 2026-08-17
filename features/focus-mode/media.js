const log = require('../log');
function pauseMedia(wc) {
    try {
        wc.executeJavaScript('document.querySelectorAll("video,audio").forEach(m => { try { m.pause(); } catch {} });');
    }
    catch (e) { log.debug('media', 'pauseMedia', e); }
}

module.exports = { pauseMedia };