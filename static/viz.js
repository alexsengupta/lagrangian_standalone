// Australia-focused Mapbox visualization with bathymetry, grid,
// colored particles, 10-day tails, mode highlighting, and looping animation.
function vizMap(simData) {
  mapboxgl.accessToken = 'pk.eyJ1IjoiYWxleHNnIiwiYSI6ImNtZHNoa3l4NjBxbW4yam9oM2ZubDhvdGEifQ.RgU1tY3-ij_9UEWCaOFpEg';
  const { lon_min, lon_max, lat_min, lat_max } = simData.bounds;
  const boundsSW = [lon_min, lat_min], boundsNE = [lon_max, lat_max];
  const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/light-v11',
    bounds: [boundsSW, boundsNE],
    fitBoundsOptions: { padding: 20 }
  });

  map.on('load', () => {
    // Bathymetry
    map.addSource('bathymetry', { type: 'vector', url: 'mapbox://mapbox.mapbox-bathymetry-v2' });
    map.addLayer({
      id: 'bath-fill', type: 'fill', source: 'bathymetry', 'source-layer': 'depth',
      paint: { 'fill-color': 'rgba(0,100,255,0.1)', 'fill-outline-color': 'rgba(0,0,255,0.2)' }
    });
    map.addLayer({
      id: 'bath-contour', type: 'line', source: 'bathymetry', 'source-layer': 'depth',
      paint: { 'line-color': 'rgba(0,0,0,0.3)', 'line-width': 0.5 },
      layout: { 'line-join': 'round', 'line-cap': 'round' }
    });

    // Grid
    const gridFeats = [];
    for (let x = boundsSW[0]; x <= boundsNE[0]; x += 5) {
      gridFeats.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[x, boundsSW[1]], [x, boundsNE[1]]] }
      });
    }
    for (let y = boundsSW[1]; y <= boundsNE[1]; y += 5) {
      gridFeats.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[boundsSW[0], y], [boundsNE[0], y]] }
      });
    }
    map.addSource('grid', { type: 'geojson', data: { type: 'FeatureCollection', features: gridFeats } });
    map.addLayer({
      id: 'grid', type: 'line', source: 'grid',
      paint: { 'line-color': '#555', 'line-width': 0.5 }
    });

    // Particles & trails
    map.addSource('particles', { type: 'geojson', data: emptyGeo() });
    map.addLayer({
      id: 'particles', type: 'circle', source: 'particles',
      paint: { 'circle-radius': 4, 'circle-color': ['get', 'color'] }
    });
    map.addSource('trails', { type: 'geojson', data: emptyGeo() });
    map.addLayer({
      id: 'trails', type: 'line', source: 'trails',
      paint: { 'line-width': 2, 'line-color': ['get', 'color'] }
    });

    setupControls(map, simData);
  });
}

function emptyGeo() {
  return { type: 'FeatureCollection', features: [] };
}

  function setupControls(map, simData) {
    const slider    = document.getElementById('aus-manual-slider');
    const label     = document.getElementById('aus-time-label');
    const btnM      = document.getElementById('btn-manual');
    const btnT      = document.getElementById('btn-traj');
    const tabA      = document.getElementById('btn-anim');
    const btnA      = document.getElementById('aus-anim-btn');
    const btnR      = document.getElementById('aus-reset-btn');
    const statusA   = document.getElementById('aus-anim-status');
    const saveBtn   = document.getElementById('aus-save-btn');
    const speed     = document.getElementById('aus-speed-slider');
    const speedLbl  = document.getElementById('aus-speed-label');
    speed.min = 25;
    speed.max = 1000;
    speed.step = 10;
    speed.value = 25;
    const ctrlM     = document.getElementById('manual-controls');
    const ctrlS     = document.getElementById('anim-speed-controls');

  const TS = simData.TS, dt = simData.dt, mNP = simData.mNP;
  const daysStep = dt / 24, tailFrames = Math.floor(10 / daysStep);
  const colors = Array.from({ length: mNP }, (_, i) => `hsl(${i * 360 / mNP},70%,50%)`);

  slider.min = 0; slider.max = TS - 1; slider.step = 1; slider.value = 0;
  updateLabel();

  let view = 'manual', animId = null, intervalFn;

  function updateUI() {
    ctrlM.style.display = view === 'manual' ? 'inline-block' : 'none';
    ctrlS.style.display = view === 'anim'   ? 'inline-block' : 'none';
    btnA.style.display  = view === 'anim'   ? 'inline-block' : 'none';
    btnR.style.display  = view === 'anim'   ? 'inline-block' : 'none';
    [btnM, btnT, tabA].forEach(b =>
      b.classList.toggle('active', (view === 'manual' && b === btnM) ||
                                (view === 'traj'   && b === btnT) ||
                                (view === 'anim'   && b === tabA))
    );
    if (view !== 'traj') {
      slider.value = 0;
      updateLabel();
    }
    updateMap();
  }

  btnM.onclick = () => { view = 'manual';  clearAnimation(); updateUI(); };
  btnT.onclick = () => { view = 'traj';    clearAnimation(); updateUI(); };
  tabA.onclick = () => { view = 'anim';    clearAnimation(); updateUI();    startAnimation(); };
  btnA.onclick = () => {
    console.log('Play button clicked; view=', view);
    if (!animId) startAnimation();
    else clearAnimation();
  };
  btnR.onclick = () => {
    clearAnimation();
    slider.value = 0;
    updateLabel();
    updateMap();
  };

  slider.oninput = () => { updateLabel(); updateMap(); };

  speed.oninput = () => {
    speedLbl.textContent = speed.value + ' ms';
    if (animId) {
      clearAnimation();
      startAnimation();
    }
  };

  // --- NEW CODE - SAVE BUTTON FUNCTIONALITY (CSV EXPORT) ---
  saveBtn.onclick = () => {
      const numParticles = simData.mNP;
      const numTimesteps = simData.TS;
      const csvRows = [];

      // 1. Create the CSV Header
      const headerParts = ['time'];
      for (let i = 1; i <= numParticles; i++) {
          headerParts.push(`lonP${i}`, `latP${i}`);
      }
      csvRows.push(headerParts.join(','));

      // 2. Create a row for each timestep
      for (let t = 0; t < numTimesteps; t++) {
          const row = [simData.dates[t]]; // Start the row with the date
          for (let p = 0; p < numParticles; p++) {
              // Add lon and lat for each particle
              const lon = simData.LONP[t][p];
              const lat = simData.LATP[t][p];
              // Use an empty string for NaN values to keep CSV clean
              row.push(isNaN(lon) ? '' : lon, isNaN(lat) ? '' : lat);
          }
          csvRows.push(row.join(','));
      }

      // 3. Combine all rows into a single string with newlines
      const csvContent = csvRows.join('\n');

      // 4. Create a Blob and trigger the download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'simulation_data_aus.csv'; // Set the filename to .csv
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };
  // --- END NEW CODE ---
	  //
	  //
  function startAnimation() {
    btnA.textContent = 'Stop';
    intervalFn = () => {
      slider.value = (Number(slider.value) + 1) % (slider.max + 1);
      statusA.textContent = updateLabel();
      updateMap();
    };
    animId = setInterval(intervalFn, Number(speed.value));
  }

  function clearAnimation() {
    if (animId) clearInterval(animId);
    animId = null;
    statusA.textContent = 'Stopped';
    btnA.textContent = 'Start';
  }

  function updateLabel() {
    const time = (slider.value * daysStep).toFixed(1) + ' d';
    label.textContent = time;
    return time;
  }

  function updateMap() {
    const idx = Number(slider.value);
    const pointFeats = simData.LONP[idx].map((lon, i) => ({
      type: 'Feature',
      properties: { color: colors[i] },
      geometry: { type: 'Point', coordinates: [lon, simData.LATP[idx][i]] }
    }));

    const trailFeats = [];
    if (view === 'traj') {
      for (let i = 0; i < mNP; i++) {
        const coords = simData.LONP.map((r, j) => [r[i], simData.LATP[j][i]])
          .filter(c => !isNaN(c[0]));
        trailFeats.push({
          type: 'Feature',
          properties: { color: colors[i] },
          geometry: { type: 'LineString', coordinates: coords }
        });
      }
    } else {
      const start = Math.max(0, idx - tailFrames);
      for (let i = 0; i < mNP; i++) {
        const coords = simData.LONP.slice(start, idx + 1)
          .map((r, j) => [r[i], simData.LATP[j + start][i]])
          .filter(c => !isNaN(c[0]));
        trailFeats.push({
          type: 'Feature',
          properties: { color: colors[i] },
          geometry: { type: 'LineString', coordinates: coords }
        });
      }
    }

    if (view === 'traj') {
      map.getSource('particles').setData(emptyGeo());
      map.getSource('trails').setData({ type: 'FeatureCollection', features: trailFeats });
    } else {
      map.getSource('particles').setData({ type: 'FeatureCollection', features: pointFeats });
      map.getSource('trails').setData({
        type: 'FeatureCollection',
        features: view === 'manual' ? [] : trailFeats
      });
    }
  }

  updateUI();
}
