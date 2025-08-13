/*
 Aragonite Mapbox overlay
 - Fetches per-year 2D slices from /api/aragonite/slice
 - Renders a canvas (lon x lat) -> PNG and overlays as a Mapbox image source
 - Supports RCP/display toggles, year slider, and click-to-sample (calls /api/aragonite/point)
*/

(async function(){
  // If mapboxgl isn't loaded on this page, bail out so three.js globe can be used as primary UI
  if (typeof mapboxgl === 'undefined') {
    console.warn('mapboxgl is not defined — skipping Mapbox overlay (three.js globe will be used)');
    return;
  }
  // Mapbox token reused from viz.js
  const MAPBOX_TOKEN = 'pk.eyJ1IjoiYWxleHNnIiwiYSI6ImNtZHNoa3l4NjBxbW4yam9oM2ZubDhvdGEifQ.RgU1tY3-ij_9UEWCaOFpEg';

  function qs(id){ return document.getElementById(id); }
  const mapDiv = qs('map-graph');
  const yearSlider = qs('year-slider');
  const yearLabel = qs('year-label');
  const toggleRcpBtn = qs('toggle-rcp');
  const rcpState = qs('rcp-state');
  const toggleDispBtn = qs('toggle-display');
  const displayModeLabel = qs('display-mode');
  const latInput = qs('lat-input');
  const lonInput = qs('lon-input');
  const saveBtn = qs('save-button');

  // Debug overlay helper (no-op in final UI)
  function setDebug(msg) {
    // intentionally left blank — debug UI removed
  }

  let meta = null;
  let years = [];
  let currentIdx = 0;
  let currentYear = 1980;
  let currentRCP = 'RCP45';
  let currentMode = 'abs';

  async function fetchMeta(){
    const res = await fetch('/api/aragonite/meta');
    if(!res.ok) throw new Error('meta fetch failed');
    return await res.json();
  }

  async function fetchSlice(year, rcp, mode){
    const params = new URLSearchParams({ year: String(year), rcp: String(rcp), mode: String(mode) });
    const res = await fetch('/api/aragonite/slice?' + params.toString());
    if(!res.ok){
      const txt = await res.text();
      throw new Error('slice fetch failed: ' + txt);
    }
    return await res.json();
  }

  // Simple color mapping functions
  function lerp(a,b,t){ return a + (b-a)*t; }
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  // Plasma-like (simple) for absolute 0..5
  function colorForAbs(v){
    // map v in [0,5] to color ramp: darkblue -> lightseagreen -> white
    const t = clamp((v - 0.0) / (5.0 - 0.0), 0, 1);
    // key colors
    const c0 = [47, 79, 79];   // darkslate
    const c1 = [32,178,170];   // lightseagreen
    const c2 = [255,255,255];  // white
    if(t < 0.5){
      const tt = t / 0.5;
      return [ Math.round(lerp(c0[0], c1[0], tt)),
               Math.round(lerp(c0[1], c1[1], tt)),
               Math.round(lerp(c0[2], c1[2], tt)) ];
    } else {
      const tt = (t - 0.5) / 0.5;
      return [ Math.round(lerp(c1[0], c2[0], tt)),
               Math.round(lerp(c1[1], c2[1], tt)),
               Math.round(lerp(c1[2], c2[2], tt)) ];
    }
  }

  // Relative color: -2..0 -> darkblue to white
  function colorForRel(v){
    const t = clamp((v - (-2)) / (0 - (-2)), 0, 1);
    const c0 = [25,25,112]; // midnightblue
    const c1 = [255,255,255];
    return [ Math.round(lerp(c0[0], c1[0], t)),
             Math.round(lerp(c0[1], c1[1], t)),
             Math.round(lerp(c0[2], c1[2], t)) ];
  }

  // Build canvas image from z (2D array: lat rows x lon cols)
  function canvasFromZ(z, lons, lats, mode){
    const height = z.length; // lat
    const width = (z[0] || []).length; // lon
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(width, height);
    for(let i=0;i<height;i++){
      for(let j=0;j<width;j++){
        const idx = (i*width + j) * 4;
        const val = z[i][j];
        if(val === null || val === undefined || Number.isNaN(val)){
          // transparent pixel
          img.data[idx] = 0; img.data[idx+1] = 0; img.data[idx+2] = 0; img.data[idx+3] = 0;
        } else {
          const rgb = (mode === 'abs') ? colorForAbs(val) : colorForRel(val);
          img.data[idx] = rgb[0];
          img.data[idx+1] = rgb[1];
          img.data[idx+2] = rgb[2];
          img.data[idx+3] = 230; // alpha
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  // Mapbox image overlay helper
  function overlayImageOnMap(map, canvas){
    // Convert canvas to data URL
    const dataUrl = canvas.toDataURL('image/png');
    const sourceId = 'aragonite_img';
    const layerId = 'aragonite_layer';
    // Coordinates: top-left, top-right, bottom-right, bottom-left in [lon,lat]
    const coords = [[-180,60],[180,60],[180,-60],[-180,-60]];
    // Remove old if exists
    if(map.getLayer(layerId)) {
      try { map.removeLayer(layerId); } catch(e){}
    }
    if(map.getSource(sourceId)){
      try { map.removeSource(sourceId); } catch(e){}
    }
    map.addSource(sourceId, { type: 'image', url: dataUrl, coordinates: coords });
    map.addLayer({
      id: layerId,
      type: 'raster',
      source: sourceId,
      paint: { 'raster-opacity': 0.9 }
    });
  }

  // Initialize
  try {
    meta = await fetchMeta();
    years = (meta.years_hist || []).concat(meta.years_future || []);
    if(!years.length) throw new Error('no years');

    currentIdx = 0;
    currentYear = years[currentIdx];

    yearSlider.min = 0;
    yearSlider.max = years.length - 1;
    yearSlider.step = 1;
    yearSlider.value = currentIdx;
    yearLabel.textContent = currentYear;

    // Setup mapbox
    mapboxgl.accessToken = MAPBOX_TOKEN;
    // Ensure container is clean (remove any existing globe canvas or stray children)
    if (mapDiv) {
      mapDiv.innerHTML = '';
      // set an explicit height to help Mapbox initialize correctly
      mapDiv.style.width = '100%';
      mapDiv.style.height = '520px';
    }
    const map = new mapboxgl.Map({
      container: mapDiv,
      style: 'mapbox://styles/mapbox/light-v11',
      projection: 'mercator',
      center: [180, 0],
      zoom: 1.5,
      maxZoom: 6,
      minZoom: 1
    });
    // expose map for debugging in browser console
    try { window.arag_map = map; } catch(e) { /* ignore */ }

    // Enforce flat Mercator behaviour and disable globe-like interactions/visual masks.
    try {
      // Set pitch/bearing to neutral and disable world wrapping
      map.setPitch(0);
      map.setBearing(0);
      map.setRenderWorldCopies(false);

      // Disable rotation gestures so the view behaves like a flat map
      if (map.dragRotate && typeof map.dragRotate.disable === 'function') map.dragRotate.disable();
      if (map.touchZoomRotate && typeof map.touchZoomRotate.disableRotation === 'function') map.touchZoomRotate.disableRotation();

      // Ensure container/canvas have no circular masking
      if (mapDiv) {
        mapDiv.style.borderRadius = '0';
        mapDiv.style.overflow = 'visible';
      }
      map.on('load', () => {
        try {
          const canvas = map.getCanvas();
          if (canvas) {
            canvas.style.borderRadius = '0';
            canvas.style.clipPath = 'none';
          }
        } catch (e) { /* ignore */ }
      });
    } catch (e) {
      console.warn('Could not enforce flat projection/mask cleanup:', e);
    }

    // Helper to update the overlay with UI locking and debug messages
    async function updateOverlay(year, rcp, mode) {
      try {
        // disable UI briefly
        toggleRcpBtn.disabled = true;
        toggleDispBtn.disabled = true;
        yearSlider.disabled = true;
        setDebug(`Loading ${year} ${rcp} ${mode}...`);
        const slice = await fetchSlice(year, rcp, mode);
        const canvas = canvasFromZ(slice.z, slice.lon, slice.lat, mode);
        overlayImageOnMap(map, canvas);
        setDebug(`Overlay updated: ${year} ${rcp} ${mode}`);
      } catch (err) {
        console.error('updateOverlay error', err);
        setDebug('Overlay update failed: ' + (err.message || err));
      } finally {
        toggleRcpBtn.disabled = false;
        toggleDispBtn.disabled = false;
        yearSlider.disabled = false;
      }
    }

    map.on('load', async () => {
      // Enforce flat Mercator projection and disable globe-like rotation/tilt on load
      try {
        if (typeof map.setProjection === 'function') {
          map.setProjection({ name: 'mercator' });
        }
        map.setPitch(0);
        map.setBearing(0);
        if (typeof map.setRenderWorldCopies === 'function') {
          map.setRenderWorldCopies(false);
        }
        if (map.dragRotate && typeof map.dragRotate.disable === 'function') map.dragRotate.disable();
        if (map.touchZoomRotate && typeof map.touchZoomRotate.disableRotation === 'function') map.touchZoomRotate.disableRotation();
        const canvas = map.getCanvas();
        if (canvas) {
          canvas.style.borderRadius = '0';
          canvas.style.clipPath = 'none';
          canvas.style.transform = 'none';
        }
      } catch (e) {
        console.warn('Could not enforce flat-map settings:', e);
      }
      // initial overlay
      await updateOverlay(currentYear, currentRCP, currentMode);
    });

    // UI handlers
    toggleRcpBtn.addEventListener('click', async () => {
      // Toggle RCP and update overlay via helper
      currentRCP = (currentRCP === 'RCP45') ? 'RCP85' : 'RCP45';
      rcpState.textContent = (currentRCP === 'RCP45') ? 'RCP45 emission scenario' : 'RCP85 emission scenario';
      console.log('toggleRcp clicked ->', currentRCP);

      if (currentYear <= 2020) {
        // switch to first future year so RCP makes sense
        let futureIdx = years.findIndex(y => y >= 2030);
        if (futureIdx === -1) futureIdx = 0;
        currentIdx = futureIdx;
        currentYear = years[currentIdx];
        yearSlider.value = currentIdx;
        yearLabel.textContent = currentYear;
        setDebug('Switched to future year ' + currentYear + ' for RCP');
      }

      await updateOverlay(currentYear, currentRCP, currentMode);
    });

    toggleDispBtn.addEventListener('click', async () => {
      currentMode = (currentMode === 'abs') ? 'rel' : 'abs';
      displayModeLabel.textContent = (currentMode === 'abs') ? 'Aragonite Concentration' : 'Aragonite Concentration relative to 1980';
      console.log('toggleDisplay clicked ->', currentMode);
      setDebug('Toggling display to ' + currentMode);
      await updateOverlay(currentYear, currentRCP, currentMode);
    });

    yearSlider.addEventListener('input', async (ev) => {
      currentIdx = parseInt(ev.target.value, 10);
      currentYear = years[currentIdx];
      yearLabel.textContent = currentYear;
      setDebug('Switching to year ' + currentYear);
      await updateOverlay(currentYear, currentRCP, currentMode);
    });

    // Click-to-sample
    map.on('click', async (e) => {
      const { lng, lat } = e.lngLat;
      console.log('map click at', { lng, lat, year: currentYear, rcp: currentRCP, mode: currentMode });
      setDebug(`Click ${lat.toFixed(3)}, ${lng.toFixed(3)} (y${currentYear})`);
      // compute consistent display lon (-180..180)
      const displayLon = (lng > 180) ? (lng - 360) : ((lng < -180) ? (lng + 360) : lng);
      // Call point API (server accepts -180..180 or 0..360; it normalizes)
      const params = new URLSearchParams({ lat: String(lat), lon: String(lng), year: String(currentYear), rcp: currentRCP, mode: currentMode });
      const res = await fetch('/api/aragonite/point?' + params.toString());
      if(!res.ok){
        console.error('point fetch failed');
        setDebug('Point fetch failed: HTTP ' + res.status);
        return;
      }
      const payload = await res.json();
      if(payload.error){
        console.error('point error', payload.error);
        setDebug('Point error: ' + payload.error);
        return;
      }
      console.log('point payload', payload);
      setDebug('Value: ' + (payload.value === null ? 'No data' : payload.value));
      latInput.value = String(lat.toFixed(4));
      lonInput.value = String(displayLon.toFixed(4));
      // Optionally show a popup (handle null values safely)
      (function(){
        const valText = (payload && (payload.value === null || payload.value === undefined)) ? 'No data' : Number(payload.value).toFixed(3);
        new mapboxgl.Popup()
          .setLngLat([lng, lat])
          .setHTML(`<strong>Omega:</strong> ${valText}`)
          .addTo(map);
      })();
    });

    // Save button uses download API (server returns CSV content)
    saveBtn.addEventListener('click', async () => {
      const lat = parseFloat(latInput.value) || 0;
      const lon = parseFloat(lonInput.value) || 180;
      const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
      const res = await fetch('/api/aragonite/download?' + params.toString());
      if(!res.ok){
        alert('Download failed');
        return;
      }
      const payload = await res.json();
      if(payload.error){
        alert('Error: ' + payload.error);
        return;
      }
      const blob = new Blob([payload.content], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = payload.filename || 'aragonite_data.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    });

  } catch (err){
    console.error('Aragonite map init error', err);
    if(mapDiv) mapDiv.innerHTML = '<div style="color:red; padding:20px;">Initialization failed: ' + err.message + '</div>';
  }

})();
