/**
 * Aragonite Map Visualization (Plotly.js) - Final Version
 */

// --- Main State Object ---
const state = {
    year: 1980,
    rcp: 'rcp45',
    mode: 'abs', // 'abs' or 'rel'
    plotCreated: false,
    dataCache: new Map(),
    landData: null,
    clickedPoint: null,
    co2Data: null,
    isFetching: false,
};

// --- UI Element References ---
const ui = {};

/**
 * Shifts a data grid horizontally to align 0-360 longitude data for plotting.
 */
function rollLongitude(grid) {
    if (!grid || !grid[0]) return grid;
    const width = grid[0].length;
    const shift = Math.floor(width / 2);
    const rolledGrid = [];
    for (const row of grid) {
        const rolledRow = row.slice(shift).concat(row.slice(0, shift));
        rolledGrid.push(rolledRow);
    }
    return rolledGrid;
}

// --- Plotting ---
async function initialize() {
    setupUI(); // Must be first

    // Parallelize initial fetches to reduce time-to-first-render.
    await Promise.all([
        fetchMetadata(),
        fetchLandData(),
        fetchCo2Data(),
        fetchReefData()
    ]);

    await createCo2Plots();
    await updatePlot();
}

async function fetchMetadata() {
    try {
        const response = await fetch('/aragonite/api/meta');
        const meta = await response.json();
        if (meta.error) throw new Error(meta.error);
        state.years = meta.years;
        state.lat = meta.lat;
        const lon = meta.lon;
        const shift = Math.floor(lon.length / 2);
        state.lon = lon.slice(shift).map(l => l - 360).concat(lon.slice(0, shift));

        ui.slider.min = 0;
        ui.slider.max = state.years.length - 1;
        ui.slider.value = state.years.indexOf(state.year);
        ui.yearLabel.textContent = state.year;
    } catch (error) {
        console.error("Failed to fetch metadata:", error);
    }
}

async function fetchLandData() {
    // Try to load a local simplified land file first to avoid external GitHub latency.
    async function tryUrl(url) {
        const r = await fetch(url);
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
    }

    try {
        let geojsonData;
        try {
            // Prefer a locally hosted simplified land GeoJSON if present
            const staticBase = (window.STATIC_URL !== undefined) ? window.STATIC_URL : '/static/';
            geojsonData = await tryUrl(staticBase + 'land_simple.geojson');
            } catch (localErr) {
            // Fallback to the upstream GitHub source if local file not available
            geojsonData = await tryUrl('https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json');
        }

        const land_x = [];
        const land_y = [];
        for (const feature of geojsonData.features) {
            const geom = feature.geometry;
            const polygons = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
            for (const polygon of polygons) {
                land_x.push(null);
                land_y.push(null);
                for (const coord of polygon[0]) {
                    land_x.push(coord[0]);
                    land_y.push(coord[1]);
                }
            }
        }
        state.landData = { x: land_x, y: land_y };
    } catch (error) {
        console.error("Failed to fetch land data:", error);
        state.landData = { x: [], y: [] };
    }
}

async function fetchCo2Data() {
    try {
        const response = await fetch('/aragonite/api/co2_data');
        state.co2Data = await response.json();
        if (state.co2Data.error) throw new Error(state.co2Data.error);
    } catch (error) {
        console.error("Failed to fetch CO2 data:", error);
    }
}

/**
 * Load reef locations CSV from static and store as lon/lat arrays on state.
 * CSV is expected to be "lon,lat" per line. Longitudes > 180 are wrapped to -180..180.
 */
async function fetchReefData() {
    try {
        const resp = await fetch('/aragonite/api/reefs');
        if (!resp.ok) {
            console.warn('Reefs API returned', resp.status);
            state.reefLon = [];
            state.reefLat = [];
            return;
        }
        const obj = await resp.json();
        if (obj.error) {
            console.warn('Reefs API error:', obj.error);
            state.reefLon = [];
            state.reefLat = [];
            return;
        }
        const lonArr = Array.isArray(obj.lon) ? obj.lon : [];
        const latArr = Array.isArray(obj.lat) ? obj.lat : [];
        const reefLon = lonArr.map(l => {
            const ln = Number(l);
            if (!Number.isFinite(ln)) return null;
            return ln > 180 ? ln - 360 : ln;
        }).filter(v => v !== null);
        const reefLat = latArr.map(l => Number(l)).filter(v => Number.isFinite(v));
        // Ensure same length by truncating to the shorter length if necessary
        const n = Math.min(reefLon.length, reefLat.length);
        state.reefLon = reefLon.slice(0, n);
        state.reefLat = reefLat.slice(0, n);
        console.log('Loaded', state.reefLon.length, 'reef locations (from API)');
    } catch (err) {
        console.error('Failed to load reef locations:', err);
        state.reefLon = [];
        state.reefLat = [];
    }
}

async function updatePlot() {
    if (!state.years || state.isFetching) return;
    state.isFetching = true;

    const cacheKey = `${state.year}-${state.rcp}-${state.mode}`;
    let data = state.dataCache.get(cacheKey);

    if (!data) {
        try {
            const response = await fetch(`/aragonite/api/slice?year=${state.year}&rcp=${state.rcp}&mode=${state.mode}`);
            data = await response.json();
            if (data.error) throw new Error(data.error);
            data.z = rollLongitude(data.z);
            state.dataCache.set(cacheKey, data);
        } catch (error) {
            console.error("Failed to fetch data slice:", error);
            state.isFetching = false;
            return;
        }
    }

    const zmin = state.mode === 'abs' ? 0 : -2;
    const zmax = state.mode === 'abs' ? 4.5 : 0;
    const contourSize = 0.1;
    const ncontours = Math.max(8, Math.round((zmax - zmin) / contourSize));
    const plotData = [
        { // Land layer
            type: 'scatter', mode: 'lines', x: state.landData.x, y: state.landData.y,
            fill: 'toself', fillcolor: '#808080', line: { color: '#808080', width: 0 }, hoverinfo: 'none'
        },
            { // Reef locations (points)
            type: 'scatter', mode: 'markers',
            x: (state.reefLon || []), y: (state.reefLat || []),
            marker: { color: 'black', size: 4, symbol: 'circle', opacity: 0.85, line: { width: 0 } },
            hoverinfo: 'none',
            name: 'Reefs'
        },
        { // Main filled contour layer
            type: 'contour',
            x: state.lon, y: state.lat, z: data.z,
            coloring: 'fill',
            contours: { showlines: false, start: zmin, end: zmax, size: 0.25 },
            coloraxis: 'coloraxis'
        },
        { // Dense contour lines
            type: 'contour', x: state.lon, y: state.lat, z: data.z, showscale: false, coloring: 'lines',
            line: { color: 'rgba(0,0,0,0.4)', width: 0.5, smoothing: 0.85 },
            contours: { 
                start: zmin,
                end: zmax,
                size: 0.25 
            }
        }
    ];

    if (state.mode === 'abs') {
        plotData.push({ // Special line for aragonite = 3
            type: 'contour', x: state.lon, y: state.lat, z: data.z, showscale: false, coloring: 'lines',
            line: { color: 'black', width: 1.5, dash: 'dash' },
            contours: { type: 'constraint', value: 3, operation: '=' }
        });
    }

    if (state.clickedPoint) {
        plotData.push({ // Selection marker
            type: 'scatter', mode: 'markers', x: [state.clickedPoint.x], y: [state.clickedPoint.y],
            marker: { color: 'red', size: 8, symbol: 'circle', line: { color: 'white', width: 1 } },
            hoverinfo: 'none'
        });
    }

    const titleText = state.mode === 'abs' ? 'Aragonite Saturation' : 'Aragonite saturation relative to 1980';
    // Rounded rectangle shapes to sit behind annotations (paper coordinates).
    const leftBox = {
        x0: 0.007, y0: 0.94, x1: 0.30, y1: 0.995, rx: 0.01
    };
    const rightBox = {
        x0: 0.70, y0: 0.94, x1: 0.993, y1: 0.995, rx: 0.01
    };

    function roundedRectPath(b) {
        // Build an SVG path for a rounded rectangle in paper coords.
        const x0 = b.x0.toFixed(3), y0 = b.y0.toFixed(3);
        const x1 = b.x1.toFixed(3), y1 = b.y1.toFixed(3);
        const rx = b.rx.toFixed(3);
        const x0r = (b.x0 + b.rx).toFixed(3);
        const x1r = (b.x1 - b.rx).toFixed(3);
        const y0r = (b.y0 + b.rx).toFixed(3);
        const y1r = (b.y1 - b.rx).toFixed(3);
        return [
            `M${x0r},${y0}`,
            `L${x1r},${y0}`,
            `A${rx},${rx} 0 0 1 ${x1},${y0r}`,
            `L${x1},${y1r}`,
            `A${rx},${rx} 0 0 1 ${x1r},${y1}`,
            `L${x0r},${y1}`,
            `A${rx},${rx} 0 0 1 ${x0},${y1r}`,
            `L${x0},${y0r}`,
            `A${rx},${rx} 0 0 1 ${x0r},${y0}`,
            'Z'
        ].join(' ');
    }

    const layout = {
        title: { text: titleText, x: 0.5, xanchor: 'center', font: { size: 18 } },
        xaxis: { title: 'Longitude', range: [-180, 180], zeroline: false },
        yaxis: { title: 'Latitude', range: [-60, 60], zeroline: false },
        showlegend: false, margin: { l: 50, r: 50, b: 50, t: 100, pad: 4 },
        plot_bgcolor: '#1a2033',
        // Annotation boxes for scenario/year (use annotation bgcolor + border so they remain visible)
        annotations: [
            {   // Scenario box - top-left with visible border/background
                xref: 'paper', yref: 'paper',
                x: 0.02, y: 0.98,
                xanchor: 'left', yanchor: 'top',
                text: `<b>Scenario:</b> ${state.rcp.toUpperCase()}`,
                showarrow: false,
                bgcolor: '#ffffff',
                bordercolor: '#000000',
                borderwidth: 2,
                borderpad: 6,
                font: { color: '#000', size: 16, family: 'Arial, sans-serif' },
                align: 'left',
                opacity: 1,
                // keep annotation above traces
                layer: 'above'
            },
            {   // Year box - top-right with visible border/background
                xref: 'paper', yref: 'paper',
                x: 0.98, y: 0.98,
                xanchor: 'right', yanchor: 'top',
                text: `<b>Year:</b> ${state.year}`,
                showarrow: false,
                bgcolor: '#ffffff',
                bordercolor: '#000000',
                borderwidth: 2,
                borderpad: 6,
                font: { color: '#000', size: 16, family: 'Arial, sans-serif' },
                align: 'right',
                opacity: 1,
                layer: 'above'
            }
        ],
        coloraxis: {
            colorscale: 'RdBu',
            cmin: zmin,
            cmax: zmax,
            cmid: state.mode === 'abs' ? 3 : undefined,
            colorbar: { title: 'Aragonite', titleside: 'right', tick0: zmin, dtick: 0.25 }
        }
    };

    Plotly.react('plot-container', plotData, layout, { responsive: true });
    // Debug: log trace info so we can confirm which trace provides the colorbar
    try {
        const gd = document.getElementById('plot-container');
        if (gd && gd.data) {
            console.log('Plot traces (index, type, showscale, zmin, zmax, colorscale):',
                gd.data.map((t, i) => ({
                    i,
                    type: t.type,
                    showscale: !!t.showscale,
                    zmin: t.zmin,
                    zmax: t.zmax,
                    colorscale: t.colorscale,
                    contours: t.contours
                }))
            );
        }
    } catch (e) {
        console.warn('Debug log failed', e);
    }

    if (!state.plotCreated) {
        document.getElementById('plot-container').on('plotly_click', (data) => {
            if (data.points[0] && data.points[0].data.type === 'contour') {
                const point = data.points[0];
                ui.latInput.value = point.y.toFixed(4);
                ui.lonInput.value = point.x.toFixed(4);
                state.clickedPoint = { x: point.x, y: point.y };
                updatePlot();
            }
        });
        state.plotCreated = true;
    }
    state.isFetching = false;
}

async function createCo2Plots() {
    if (!state.co2Data) return;

    const common_layout = {
        margin: { l: 50, r: 20, b: 40, t: 40 },
        showlegend: true,
        legend: { x: 0.05, y: 0.95, bgcolor: 'rgba(255,255,255,0.6)' },
        xaxis: { range: [1980, 2100] },
        shapes: [{
            type: 'line',
            x0: state.year, x1: state.year,
            y0: 0, y1: 1,
            yref: 'paper',
            line: { color: 'black', dash: 'dash', width: 1.5 }
        }]
    };

    // Concentration Plot
    const conc_traces = [
        { x: state.co2Data.years, y: state.co2Data.conc45, name: 'RCP45', line: { color: 'blue' } },
        { x: state.co2Data.years, y: state.co2Data.conc85, name: 'RCP85', line: { color: 'red' } }
    ];
    const conc_layout = { ...common_layout, title: 'CO2 Concentration (ppm)', yaxis: { range: [300, 1000] } };
    Plotly.newPlot('co2-conc-plot', conc_traces, conc_layout, { responsive: true });

    // Emissions Plot
    const emm_traces = [
        { x: state.co2Data.years, y: state.co2Data.emm45, name: 'RCP45', line: { color: 'blue' } },
        { x: state.co2Data.years, y: state.co2Data.emm85, name: 'RCP85', line: { color: 'red' } }
    ];
    const emm_layout = { ...common_layout, title: 'CO2 Emissions (PgC/yr)', yaxis: { range: [0, 30] } };
    Plotly.newPlot('co2-emm-plot', emm_traces, emm_layout, { responsive: true });
}

// --- UI Setup and Event Handlers ---
function setupUI() {
    ui.slider = document.getElementById('year-slider');
    ui.yearLabel = document.getElementById('year-label');
    ui.rcpBtn = document.getElementById('toggle-rcp');
    ui.rcpLabel = document.getElementById('rcp-label');
    ui.displayBtn = document.getElementById('toggle-display');
    ui.modeLabel = document.getElementById('mode-label');
    ui.saveBtn = document.getElementById('save-button');
    ui.latInput = document.getElementById('lat-input');
    ui.lonInput = document.getElementById('lon-input');

    // Helper: show a modal help overlay with HTML content
    function showHelpModal(title, html) {
        // remove any existing modal
        const existing = document.getElementById('aragonite-help-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'aragonite-help-overlay';
        Object.assign(overlay.style, {
            position: 'fixed', left: 0, top: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: '20px'
        });

        const box = document.createElement('div');
        Object.assign(box.style, {
            width: '680px', maxWidth: '95%', background: '#fff', borderRadius: '10px',
            padding: '18px', boxShadow: '0 6px 24px rgba(0,0,0,0.3)', color: '#111',
            fontFamily: 'Arial, sans-serif', lineHeight: '1.4'
        });

        const hdr = document.createElement('div');
        hdr.style.display = 'flex';
        hdr.style.justifyContent = 'space-between';
        hdr.style.alignItems = 'center';
        const h = document.createElement('h3');
        h.textContent = title || 'Help';
        h.style.margin = '0 0 8px 0';
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '✕';
        Object.assign(closeBtn.style, {
            background: 'transparent', border: 'none', fontSize: '18px', cursor: 'pointer'
        });
        closeBtn.addEventListener('click', () => overlay.remove());
        hdr.appendChild(h);
        hdr.appendChild(closeBtn);

        const content = document.createElement('div');
        content.innerHTML = html;

        const footer = document.createElement('div');
        footer.style.marginTop = '12px';
        const ok = document.createElement('button');
        ok.textContent = 'Close';
        Object.assign(ok.style, {
            padding: '8px 12px', background: '#007bff', color: '#fff', border: 'none',
            borderRadius: '6px', cursor: 'pointer'
        });
        ok.addEventListener('click', () => overlay.remove());
        footer.appendChild(ok);

        box.appendChild(hdr);
        box.appendChild(content);
        box.appendChild(footer);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    // Create a main help button (top-right)
    const mainHelpBtn = document.createElement('button');
    mainHelpBtn.id = 'main-help-btn';
    mainHelpBtn.textContent = 'Help';
    Object.assign(mainHelpBtn.style, {
        position: 'fixed', top: '12px', right: '12px', zIndex: 1500,
        padding: '8px 12px', background: '#007bff', color: '#fff', border: 'none',
        borderRadius: '8px', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
        fontFamily: 'Arial, sans-serif'
    });
    mainHelpBtn.addEventListener('click', () => {
        const html = `
            <p>The map displays Aragonite Saturation State.</p>
            <ul>
              <li>Use the <b>YEAR</b> slider to examine Aragonite levels at different times in the past and future.
                (1980-2020 are based on observations; 2030-2100 are based on climate model projections).</li>
              <li>Toggle between <b>Aragonite</b> and <b>Aragonite relative to 1980</b> using the Mode control.</li>
              <li>Click on the map to select a location (the Lat/Lon fields will update). Press <b>Save Data</b> to download CSV for that location
                (year, Aragonite, Aragonite change relative to 1980).</li>
              <li>3.0 is a critical threshold — below this value coral reefs generally do not grow.</li>
              <li>Press the <b>Run Experiment</b> button to start the simulation (if available).</li>
            </ul>
        `;
        showHelpModal('Aragonite Map — Help & Usage', html);
    });
    document.body.appendChild(mainHelpBtn);

    // Utility to create small inline help buttons next to controls
    function makeInlineHelp(targetEl, title, html) {
        if (!targetEl || !targetEl.parentNode) return;
        const help = document.createElement('button');
        help.innerHTML = '?';
        Object.assign(help.style, {
            marginLeft: '8px', padding: '0 7px', height: '24px', lineHeight: '20px',
            borderRadius: '12px', border: '1px solid #333', background: '#fff',
            cursor: 'pointer', fontWeight: 'bold', fontFamily: 'Arial, sans-serif'
        });
        help.title = title;
        help.addEventListener('click', () => showHelpModal(title, html));
        // insert after the control
        if (targetEl.nextSibling) targetEl.parentNode.insertBefore(help, targetEl.nextSibling);
        else targetEl.parentNode.appendChild(help);
    }

    ui.slider.addEventListener('input', handleSliderChange);
    ui.rcpBtn.addEventListener('click', handleRcpToggle);
    ui.displayBtn.addEventListener('click', handleDisplayToggle);
    ui.saveBtn.addEventListener('click', handleSave);

    // Add inline help buttons with appropriate messages
    const sliderHelpHtml = `
        <p>YEAR slider: select a year from 1980 through 2100 (in 10-year increments).</p>
        <p>1980-2020: historical/observations. 2030-2100: model projections.</p>
        <p>Note: Aragonite = 3.0 is shown as a dashed contour and is a critical threshold for coral growth.</p>
    `;
    makeInlineHelp(ui.slider, 'Year slider help', sliderHelpHtml);

    const rcpHelpHtml = `
        <p>Scenario (RCP):</p>
        <ul>
          <li><b>RCP45</b> — moderate emissions pathway.</li>
          <li><b>RCP85</b> — higher emissions pathway.</li>
        </ul>
        <p>Use the toggle to switch between scenarios for future years (2030+).</p>
    `;
    makeInlineHelp(ui.rcpBtn, 'Scenario help', rcpHelpHtml);

    const displayHelpHtml = `
        <p>Display mode:</p>
        <ul>
          <li><b>Absolute</b> — shows raw Aragonite saturation state.</li>
          <li><b>Relative</b> — shows change relative to the 1980 baseline.</li>
        </ul>
    `;
    makeInlineHelp(ui.displayBtn, 'Display mode help', displayHelpHtml);

    const saveHelpHtml = `
        <p>Save Data:</p>
        <p>After selecting a location on the map, press this button to download a CSV containing the year, Aragonite value and Aragonite change relative to 1980 for that location.</p>
    `;
    makeInlineHelp(ui.saveBtn, 'Save data help', saveHelpHtml);
}

function handleSliderChange() {
    const yearIndex = parseInt(ui.slider.value, 10);
    state.year = state.years[yearIndex];
    ui.yearLabel.textContent = state.year;
    updatePlot();

    // Update the vertical line on the CO2 plots
    if (state.co2Data) {
        const update = { 'shapes[0].x0': state.year, 'shapes[0].x1': state.year };
        Plotly.relayout('co2-conc-plot', update);
        Plotly.relayout('co2-emm-plot', update);
    }
}

function handleRcpToggle() {
    state.rcp = state.rcp === 'rcp45' ? 'rcp85' : 'rcp45';
    ui.rcpLabel.textContent = state.rcp.toUpperCase();
    updatePlot();
}

function handleDisplayToggle() {
    state.mode = state.mode === 'abs' ? 'rel' : 'abs';
    ui.modeLabel.textContent = state.mode === 'abs' ? 'Absolute' : 'Relative';
    updatePlot();
}

async function handleSave() {
    const lat = ui.latInput.value;
    const lon = ui.lonInput.value;
    if (!lat || !lon || lat === '-') {
        alert("Please click on the map to select a location first.");
        return;
    }
    try {
        const response = await fetch(`/aragonite/api/download?lat=${lat}&lon=${lon}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        let content = data.content;

        // If CO2 data is available client-side, append CO2 concentration & emissions columns for both RCPs.
        if (state.co2Data && Array.isArray(state.co2Data.years)) {
            const years = state.co2Data.years;
            const conc45 = state.co2Data.conc45 || [];
            const conc85 = state.co2Data.conc85 || [];
            const emm45 = state.co2Data.emm45 || [];
            const emm85 = state.co2Data.emm85 || [];

            const lines = content.split('\n');
            const header = lines[0] || 'Year';
            const newHeader = header + ',CO2_conc_RCP45_ppm,CO2_emm_RCP45_PgCyr,CO2_conc_RCP85_ppm,CO2_emm_RCP85_PgCyr';
            const newLines = [newHeader];

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                if (!line || !line.trim()) {
                    newLines.push(line);
                    continue;
                }
                const parts = line.split(',');
                const year = parseInt(parts[0], 10);
                const idx = years.indexOf(year);
                if (idx >= 0) {
                    const c45 = conc45[idx] !== undefined ? conc45[idx] : '';
                    const e45 = emm45[idx] !== undefined ? emm45[idx] : '';
                    const c85 = conc85[idx] !== undefined ? conc85[idx] : '';
                    const e85 = emm85[idx] !== undefined ? emm85[idx] : '';
                    newLines.push(line + `,${c45},${e45},${c85},${e85}`);
                } else {
                    newLines.push(line + ',,,,');
                }
            }
            content = newLines.join('\n');
        }

        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        // update filename to indicate CO2 included
        const filename = data.filename.replace(/\.csv$/, '') + '_with_co2.csv';
        link.download = filename;
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error("Failed to download data:", error);
    }
}

// --- Run --- 
document.addEventListener('DOMContentLoaded', initialize);
