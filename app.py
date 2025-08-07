import os
from flask import Flask, render_template, jsonify
import netCDF4 as nc
import numpy as np
from scipy.interpolate import RegularGridInterpolator
from datetime import datetime, timedelta
from flask_compress import Compress
import math
import zarr
import json

# Paths
HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, 'static')

app = Flask(
    __name__,
    template_folder=os.path.join(HERE, 'templates'),
    static_folder=os.path.join(HERE, 'static'),
    static_url_path='/lagrangian_6Aug/static'
)
Compress(app)

def parse_params(param_str):
    parts = param_str.split('_')
    lon = float(parts[0]); lat = float(parts[1])
    mNP = int(parts[2]); mAREA = float(parts[3])
    mSIM = parts[4]
    mDUR = int(parts[5]); mDT = int(parts[6])
    date_str = parts[7]
    return lon, lat, mNP, mAREA, mSIM, mDUR, mDT, date_str

def simulate_aus(mlon, mlat, mNP, mAREA, mSIM, mDUR, dt, start_date_str, ND=5):
    # Load OSCAR velocity data
    fn = os.path.join(DATA_DIR, 'oscar_vel2020_oz.nc')
    ds = nc.Dataset(fn)
    time_all = ds['time'][:]
    lat_nc = ds['latitude'][:]
    lon_nc = ds['longitude'][:]
    U = ds['u'][:].squeeze(); V = ds['v'][:].squeeze()
    U[np.isnan(U)] = 0; V[np.isnan(V)] = 0

    # Load coast & reef points
    def load_csv(name):
        path = os.path.join(DATA_DIR, name)
        with open(path) as f:
            return [list(map(float, row.split(','))) for row in f.read().splitlines()]
    try:
        map_pts = load_csv('etopo1_aus.csv')
        map_lon, map_lat = zip(*map_pts) if map_pts else ([], [])
    except Exception:
        map_lon, map_lat = [], []

    reef_pts = load_csv('reef_locs_aus.csv')
    reef_lon, reef_lat = zip(*reef_pts) if reef_pts else ([], [])

    # Initialize particle positions
    lonP = mlon + mAREA/2 * np.random.uniform(-1, 1, mNP)
    latP = mlat + mAREA/2 * np.random.uniform(-1, 1, mNP)

    # Prepare storage
    LONP = np.full((0, mNP), np.nan)
    LATP = np.full((0, mNP), np.nan)
    dates = []
    ref_date = datetime.fromisoformat(start_date_str)

    # Compute number of major steps (ND days per step)
    major_steps = math.ceil(mDUR / ND)
    # Limit to available time indices
    max_idx = len(time_all) - 1
    major_steps = min(major_steps, max_idx)

    # Build time index list
    if mSIM == 'forwards':
        time_idx = list(range(0, major_steps))
    else:
        time_idx = list(range(max_idx, max_idx - major_steps, -1))

    lat_per_m = 360 / (2 * np.pi * 6371000)

    # Loop over major indices
    for t in time_idx:
        i1, i2 = (t, t + 1) if mSIM == 'forwards' else (t, t - 1)
        u1 = U[i1, :, :]; u2 = U[i2, :, :]
        v1 = V[i1, :, :]; v2 = V[i2, :, :]

        f_u1 = RegularGridInterpolator((lat_nc, lon_nc), u1, bounds_error=False, fill_value=0)
        f_v1 = RegularGridInterpolator((lat_nc, lon_nc), v1, bounds_error=False, fill_value=0)
        f_u2 = RegularGridInterpolator((lat_nc, lon_nc), u2, bounds_error=False, fill_value=0)
        f_v2 = RegularGridInterpolator((lat_nc, lon_nc), v2, bounds_error=False, fill_value=0)

        sub_steps = int(ND * 24 / dt)
        for s in range(1, sub_steps + 1):
            frac = s / sub_steps
            d1, d2 = 1 - frac, frac

            inb = (
                (lonP >= lon_nc.min()) & (lonP <= lon_nc.max()) &
                (latP >= lat_nc.min()) & (latP <= lat_nc.max())
            )

            u1i = np.zeros(mNP); v1i = np.zeros(mNP)
            u2i = np.zeros(mNP); v2i = np.zeros(mNP)
            if np.any(inb):
                idx = np.where(inb)[0]
                pts = np.stack([latP[idx], lonP[idx]], axis=1)
                u1i[idx] = f_u1(pts); v1i[idx] = f_v1(pts)
                u2i[idx] = f_u2(pts); v2i[idx] = f_v2(pts)

            ui = d1 * u1i + d2 * u2i
            vi = d1 * v1i + d2 * v2i

            lon_per = lat_per_m / np.cos(np.radians(latP))
            dlon = ui * (dt * 3600) * lon_per
            dlat = vi * (dt * 3600) * lat_per_m

            if mSIM == 'forwards':
                lonP[inb] += dlon[inb]; latP[inb] += dlat[inb]
            else:
                lonP[inb] -= dlon[inb]; latP[inb] -= dlat[inb]

            lonP[~inb] = np.nan; latP[~inb] = np.nan

            LONP = np.append(LONP, [lonP], axis=0)
            LATP = np.append(LATP, [latP], axis=0)

            # Timestamp
            current = ref_date + timedelta(hours=len(dates) * dt)
            dates.append(current.strftime('%Y-%m-%d'))

    return {
        'LONP': LONP.tolist(),
        'LATP': LATP.tolist(),
        'TS': LONP.shape[0],
        'dt': dt,
        'dates': dates,
        'map_lon': map_lon,
        'map_lat': map_lat,
        'reef_lon': reef_lon,
        'reef_lat': reef_lat,
        'mlon': mlon,
        'mlat': mlat,
        'mAREA': mAREA,
        'mSIM': mSIM,
        'mNP': mNP,
        'bounds': {
            'lon_min': lon_nc.min(),
            'lon_max': lon_nc.max(),
            'lat_min': lat_nc.min(),
            'lat_max': lat_nc.max()
        }
    }

def simulate_gbr(mlon, mlat, mNP, mAREA, mSIM, mDUR, dt, start_date_str, ND=5):
    # Load GBR velocity data from Zarr array and separate JSON files
    zarr_path = os.path.join(DATA_DIR, 'uv.zarr')
    lats_path = os.path.join(DATA_DIR, 'uv_lats.json')
    lons_path = os.path.join(DATA_DIR, 'uv_lons.json')

    # Load coordinates from JSON files
    with open(lats_path, 'r') as f:
        lat_nc = np.array(json.load(f))
    with open(lons_path, 'r') as f:
        lon_nc = np.array(json.load(f))

    # Open the Zarr array
    z_array = zarr.open(zarr_path, mode='r')
    
    # Correctly slice U and V based on the true shape: (var, time, lat, lon)
    U = z_array[0, :, :, :]  # U data
    V = z_array[1, :, :, :]  # V data
    time_all = np.arange(z_array.shape[1]) # Time is the second dimension

    U[np.isnan(U)] = 0
    V[np.isnan(V)] = 0

    # Load coast & reef points
    def load_csv(name):
        path = os.path.join(DATA_DIR, name)
        with open(path) as f:
            return [list(map(float, row.split(','))) for row in f.read().splitlines()]
    try:
        map_pts = load_csv('etopo1_aus.csv')
        map_lon, map_lat = zip(*map_pts) if map_pts else ([], [])
    except Exception:
        map_lon, map_lat = [], []

    reef_pts = load_csv('reef_locs_aus.csv')
    reef_lon, reef_lat = zip(*reef_pts) if reef_pts else ([], [])

    # Initialize particle positions
    lonP = mlon + mAREA/2 * np.random.uniform(-1, 1, mNP)
    latP = mlat + mAREA/2 * np.random.uniform(-1, 1, mNP)

    # Prepare storage
    LONP = np.full((0, mNP), np.nan)
    LATP = np.full((0, mNP), np.nan)
    dates = []
    ref_date = datetime.fromisoformat(start_date_str)

    # Compute number of major steps (ND days per step)
    major_steps = math.ceil(mDUR / ND)
    max_idx = len(time_all) - 1
    major_steps = min(major_steps, max_idx)

    # Build time index list
    if mSIM == 'forwards':
        time_idx = list(range(0, major_steps))
    else:
        time_idx = list(range(max_idx, max_idx - major_steps, -1))

    lat_per_m = 360 / (2 * np.pi * 6371000)

    # Loop over major indices
    for t in time_idx:
        i1, i2 = (t, t + 1) if mSIM == 'forwards' else (t, t - 1)
        
        # Slice for time. Shape is now (221, 181), which matches the grid.
        u1 = U[i1, :, :]
        u2 = U[i2, :, :]
        v1 = V[i1, :, :]
        v2 = V[i2, :, :]

        f_u1 = RegularGridInterpolator((lat_nc, lon_nc), u1, bounds_error=False, fill_value=0)
        f_v1 = RegularGridInterpolator((lat_nc, lon_nc), v1, bounds_error=False, fill_value=0)
        f_u2 = RegularGridInterpolator((lat_nc, lon_nc), u2, bounds_error=False, fill_value=0)
        f_v2 = RegularGridInterpolator((lat_nc, lon_nc), v2, bounds_error=False, fill_value=0)

        sub_steps = int(ND * 24 / dt)
        for s in range(1, sub_steps + 1):
            frac = s / sub_steps
            d1, d2 = 1 - frac, frac

            inb = (
                (lonP >= lon_nc.min()) & (lonP <= lon_nc.max()) &
                (latP >= lat_nc.min()) & (latP <= lat_nc.max())
            )

            u1i = np.zeros(mNP); v1i = np.zeros(mNP)
            u2i = np.zeros(mNP); v2i = np.zeros(mNP)
            if np.any(inb):
                idx = np.where(inb)[0]
                pts = np.stack([latP[idx], lonP[idx]], axis=1)
                u1i[idx] = f_u1(pts); v1i[idx] = f_v1(pts)
                u2i[idx] = f_u2(pts); v2i[idx] = f_v2(pts)

            ui = d1 * u1i + d2 * u2i
            vi = d1 * v1i + d2 * v2i

            lon_per = lat_per_m / np.cos(np.radians(latP))
            dlon = ui * (dt * 3600) * lon_per
            dlat = vi * (dt * 3600) * lat_per_m

            if mSIM == 'forwards':
                lonP[inb] += dlon[inb]; latP[inb] += dlat[inb]
            else:
                lonP[inb] -= dlon[inb]; latP[inb] -= dlat[inb]

            lonP[~inb] = np.nan; latP[~inb] = np.nan

            LONP = np.append(LONP, [lonP], axis=0)
            LATP = np.append(LATP, [latP], axis=0)

            current = ref_date + timedelta(hours=len(dates) * dt)
            dates.append(current.strftime('%Y-%m-%d'))

    return {
        'LONP': LONP.tolist(),
        'LATP': LATP.tolist(),
        'TS': LONP.shape[0],
        'dt': dt,
        'dates': dates,
        'map_lon': map_lon,
        'map_lat': map_lat,
        'reef_lon': reef_lon,
        'reef_lat': reef_lat,
        'mlon': mlon,
        'mlat': mlat,
        'mAREA': mAREA,
        'mSIM': mSIM,
        'mNP': mNP,
        'bounds': {
            'lon_min': lon_nc.min(),
            'lon_max': lon_nc.max(),
            'lat_min': lat_nc.min(),
            'lat_max': lat_nc.max()
        }
    }


@app.route('/')
def landing():
    return render_template('landing.html')

@app.route('/aus')
def aus():
    return render_template('aus_selector.html')

@app.route('/gbr')
def gbr():
    return render_template('gbr_selector.html')

@app.route('/aus_lagrangian/<params>')
def visualize(params):
    # Run server-side simulation and pass data directly to template
    mlon, mlat, mNP, mAREA, mSIM, mDUR, mDT, date_str = parse_params(params)
    sim_data = simulate_aus(mlon, mlat, mNP, mAREA, mSIM, mDUR, mDT, date_str)
    return render_template('aus_lagrangian.html', sim_data=sim_data)

@app.route('/gbr_lagrangian/<params>')
def gbr_visualize(params):
    mlon, mlat, mNP, mAREA, mSIM, mDUR, mDT, date_str = parse_params(params)
    sim_data = simulate_gbr(mlon, mlat, mNP, mAREA, mSIM, mDUR, mDT, date_str)
    return render_template('gbr_lagrangian.html', sim_data=sim_data)

@app.route('/api/aus_sim/<params>')
def api_sim(params):
    try:
        mlon, mlat, mNP, mAREA, mSIM, mDUR, mDT, date_str = parse_params(params)
        result = simulate_aus(mlon, mlat, mNP, mAREA, mSIM, mDUR, mDT, date_str)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)})

@app.route('/api/gbr_sim/<params>')
def api_gbr_sim(params):
    try:
        mlon, mlat, mNP, mAREA, mSIM, mDUR, mDT, date_str = parse_params(params)
        result = simulate_gbr(mlon, mlat, mNP, mAREA, mSIM, mDUR, mDT, date_str)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)})

if __name__ == '__main__':
    app.run(debug=True)
