import os
import json
from functools import lru_cache
from flask import Blueprint, render_template, jsonify, request, current_app
import numpy as np
import zarr
import math

import netCDF4 as nc

aragonite_bp = Blueprint('aragonite_bp', __name__, url_prefix='/aragonite')

# Preload datasets helper (register with the Flask app using app.before_first_request).
# Blueprint objects don't expose before_app_first_request, so we expose the function
# for the main app to register it after creating the Flask app.
def _preload_aragonite():
    try:
        ensure_data_loaded()
    except Exception as e:
        current_app.logger.exception("Failed to preload aragonite data: %s", e)
    try:
        load_co2_data()
    except Exception as e:
        current_app.logger.exception("Failed to preload CO2 data: %s", e)

# Expose the preload function so app.py can register it on the Flask app:
#   app.before_first_request(aragonite_bp._preload_aragonite)
aragonite_bp._preload_aragonite = _preload_aragonite

# --- Globals for loaded data ---
_nc_file = None
_data_loaded = False
_all_years = []
_lat = []
_lon = []
_omega_hist = None
_omega_rcp45 = None
_omega_rcp85 = None
_omega_hist_rel = None
_omega_rcp45_rel = None
_omega_rcp85_rel = None

# --- Globals for CO2 data ---
_co2_data = None
_reef_cache = None

def load_co2_data():
    """Loads CO2 data from CSV, caching it in a global variable."""
    global _co2_data
    if _co2_data is not None:
        return True
    
    csv_path = os.path.join(current_app.root_path, 'static', 'co2_conc_emission.csv')
    if not os.path.exists(csv_path):
        print(f"CO2 CSV file not found at {csv_path}")
        return False
    
    try:
        data = np.loadtxt(csv_path, delimiter=',')
        _co2_data = {
            'years': data[:, 0].tolist(),
            'conc45': data[:, 1].tolist(),
            'conc85': data[:, 2].tolist(),
            'emm45': data[:, 3].tolist(),
            'emm85': data[:, 4].tolist(),
        }
        print("CO2 data loaded successfully.")
        return True
    except Exception as e:
        print(f"Error loading CO2 data: {e}")
        return False

def ensure_data_loaded():
    """Load data from NetCDF file if not already loaded."""
    global _data_loaded, _nc_file, _all_years, _lat, _lon
    global _omega_hist, _omega_rcp45, _omega_rcp85, _omega_hist_rel, _omega_rcp45_rel, _omega_rcp85_rel
    if _data_loaded:
        return True
    
    nc_path = os.path.join(current_app.root_path, 'static', 'Omega_MSCI2060.nc')
    
    if not os.path.exists(nc_path):
        print(f"NetCDF file not found at {nc_path}")
        return False
    try:
        _nc_file = nc.Dataset(nc_path, 'r')
        _lat = _nc_file.variables['lat'][:].tolist()
        _lon = _nc_file.variables['lon'][:].tolist()
        
        # The UI expects a simple list of years from 1980 to 2100
        _all_years = list(range(1980, 2021, 10)) + list(range(2030, 2101, 10))

        # Load all data into memory
        _omega_hist = _nc_file.variables['omega_hist'][:]
        _omega_rcp45 = _nc_file.variables['omega_rcp45'][:]
        _omega_rcp85 = _nc_file.variables['omega_rcp85'][:]
        
        # Pre-calculate relative anomalies
        base_1980 = _omega_hist[0, :, :]
        _omega_hist_rel = _omega_hist - base_1980
        _omega_rcp45_rel = _omega_rcp45 - base_1980
        _omega_rcp85_rel = _omega_rcp85 - base_1980

        _data_loaded = True
        print("NetCDF data loaded successfully.")
        return True
    except Exception as e:
        print(f"Error loading NetCDF data: {e}")
        import traceback
        traceback.print_exc()
        return False

def get_data_slice(year, rcp, mode):
    """Get a 2D data slice for a given year, rcp, and mode."""
    if not ensure_data_loaded():
        raise RuntimeError("Aragonite data not available on server.")

    year = int(year)
    
    if year <= 2020:
        year_idx = (year - 1980) // 10
        data_slice = _omega_hist[year_idx, :, :] if mode == 'abs' else _omega_hist_rel[year_idx, :, :]
    else:
        year_idx = (year - 2030) // 10
        if rcp == 'rcp45':
            data_slice = _omega_rcp45[year_idx, :, :] if mode == 'abs' else _omega_rcp45_rel[year_idx, :, :]
        else: # rcp85
            data_slice = _omega_rcp85[year_idx, :, :] if mode == 'abs' else _omega_rcp85_rel[year_idx, :, :]
    
    return data_slice

@aragonite_bp.route('/')
def aragonite_ui():
    """Render the main UI for the aragonite app."""
    return render_template('aragonite.html')

@aragonite_bp.route('/api/meta')
def api_meta():
    """Provide metadata to the client (years, lat, lon)."""
    if not ensure_data_loaded():
        return jsonify({'error': 'Dataset not found on server.'}), 500
    resp = jsonify({
        'years': _all_years,
        'lat': _lat,
        'lon': _lon,
        'rcps': ['rcp45', 'rcp85']
    })
    resp.headers['Cache-Control'] = 'public, max-age=86400'
    return resp

@aragonite_bp.route('/api/slice')
def api_slice():
    """Provide a 2D data slice as JSON."""
    year = request.args.get('year', '1980')
    rcp = request.args.get('rcp', 'rcp45')
    mode = request.args.get('mode', 'abs')
    
    try:
        data = get_data_slice(year, rcp, mode)
        # Quantize to shrink payload, then replace non-finite values with None for valid JSON
        s = np.round(data, 3)
        clean_data = np.where(np.isfinite(s), s, None).tolist()
        resp = jsonify({'z': clean_data})
        resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        return resp
    except (RuntimeError, ValueError) as e:
        return jsonify({'error': str(e)}), 500

@aragonite_bp.route('/api/download')
def api_download():
    """Generate and return data for all years/scenarios for a given point."""
    try:
        lat = float(request.args.get('lat'))
        lon = float(request.args.get('lon'))
    except (TypeError, ValueError):
        return jsonify({'error': 'Invalid lat/lon parameters.'}), 400

    if not ensure_data_loaded():
        return jsonify({'error': 'Dataset not found on server.'}), 500

    lat_idx = np.abs(np.array(_lat) - lat).argmin()
    lon_idx = np.abs(np.array(_lon) - lon).argmin()

    header = "Year,Aragonite_RCP45_abs,Aragonite_RCP45_rel,Aragonite_RCP85_abs,Aragonite_RCP85_rel"
    lines = [header]

    def fmt(v):
        return f'{v:.4f}' if np.isfinite(v) else ''

    for year in _all_years:
        try:
            abs45 = get_data_slice(year, 'rcp45', 'abs')[lat_idx, lon_idx]
            rel45 = get_data_slice(year, 'rcp45', 'rel')[lat_idx, lon_idx]
            abs85 = get_data_slice(year, 'rcp85', 'abs')[lat_idx, lon_idx]
            rel85 = get_data_slice(year, 'rcp85', 'rel')[lat_idx, lon_idx]
            lines.append(f"{year},{fmt(abs45)},{fmt(rel45)},{fmt(abs85)},{fmt(rel85)}")
        except Exception:
            lines.append(f"{year},,,,") # Append blanks on error

    content = "\n".join(lines)
    filename = f"aragonite_data_{lat:.2f}_{lon:.2f}.csv"
    return jsonify({'filename': filename, 'content': content})

@aragonite_bp.route('/api/co2_data')
def api_co2_data():
    """Provide CO2 data to the client."""
    if not load_co2_data():
        return jsonify({'error': 'CO2 dataset not found on server.'}), 500
    resp = jsonify(_co2_data)
    resp.headers['Cache-Control'] = 'public, max-age=86400'
    return resp


@aragonite_bp.route('/api/reefs')
def api_reefs():
    """Provide reef location list to the client as JSON."""
    global _reef_cache
    try:
        if _reef_cache is None:
            csv_path = os.path.join(current_app.root_path, 'static', 'reef_locs_glob.csv')
            if not os.path.exists(csv_path):
                return jsonify({'error': 'Reef locations file not found on server.'}), 404
            lon = []
            lat = []
            with open(csv_path, 'r') as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    parts = line.split(',')
                    if len(parts) < 2:
                        continue
                    try:
                        loni = float(parts[0])
                        lati = float(parts[1])
                    except Exception:
                        continue
                    # normalize longitudes > 180 to -180..180
                    if loni > 180:
                        loni -= 360
                    lon.append(loni)
                    lat.append(lati)
            _reef_cache = {'lon': lon, 'lat': lat}
        resp = jsonify(_reef_cache)
        resp.headers['Cache-Control'] = 'public, max-age=86400'
        return resp
    except Exception as e:
        print('Error reading reef locations:', e)
        return jsonify({'error': 'Failed to read reef locations.'}), 500
