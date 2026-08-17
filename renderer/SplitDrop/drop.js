(() => {
    'use strict';
    // Which edge the pointer is closest to; the middle means "no split".
    const EDGE = 0.32;
    let zone = null;
    const setZone = (z) => {
        zone = z;
        if (z)
            document.body.dataset.zone = z;
        else
            delete document.body.dataset.zone;
    };
    const zoneAt = (x, y) => {
        const w = window.innerWidth, h = window.innerHeight;
        if (!w || !h)
            return null;
        const fx = x / w, fy = y / h;
        const d = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy };
        let best = null;
        for (const k of Object.keys(d))
            if (best === null || d[k] < d[best])
                best = k;
        return d[best] <= EDGE ? best : null;
    };
    // The drag began in the chrome, so this view only ever sees the move and the
    // release — no pointerdown. Any move over it means the drag is here.
    document.addEventListener('pointermove', (e) => {
        document.body.classList.add('armed');
        setZone(zoneAt(e.clientX, e.clientY));
    });
    document.addEventListener('pointerup', (e) => {
        window.splitDrop.drop(zoneAt(e.clientX, e.clientY));
    });
    document.addEventListener('pointerleave', () => {
        document.body.classList.remove('armed');
        setZone(null);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape')
            window.splitDrop.cancel();
    });
    // A drag that started in ANOTHER window: main pushes the zone in, since the
    // pointer events go to the window the drag belongs to.
    window.splitDrop.onHint?.((z) => {
        document.body.classList.add('armed');
        setZone(z);
    });
    // Reused for the next drag — drop whatever the last one left painted.
    window.splitDrop.onReset?.(() => {
        document.body.classList.remove('armed');
        setZone(null);
    });
})();
