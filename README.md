# Lagrangian Particle Simulation App

This application provides interactive web-based simulations of ocean particle trajectories for two distinct regions: Australia-wide and the Great Barrier Reef (GBR).

## Features

- **Dual Simulation Modes:** Choose between a broad Australia-wide simulation and a higher-resolution Great Barrier Reef specific simulation.
- **Interactive Map:** Visualize particle movements on a Mapbox GL JS map.
- **Parameter Selection:** Users can select various simulation parameters, including:
    - Release location (latitude and longitude)
    - Number of particles
    - Release area
    - Simulation duration
    - Timestep
    - Simulation direction (forwards or backwards in time)
- **Visualization Controls:** Control playback of simulations with manual time sliders, full trajectory views, and animation modes.
- **Data Integration:** Seamlessly integrates with ocean velocity data and reef location data.

## Technologies Used

### Backend (Python - Flask)

- **Flask:** A micro web framework for Python, used to serve the web application and handle simulation logic.
- **NumPy:** Fundamental package for numerical computing in Python, used for array operations and mathematical calculations within the simulation.
- **SciPy:** Used for scientific computing, specifically `scipy.interpolate.RegularGridInterpolator` for interpolating ocean velocity data.
- **netCDF4:** Python interface to the netCDF C library, used for reading the OSCAR velocity data for the Australia-wide simulation.
- **Zarr:** A Python library for chunked, compressed, N-dimensional arrays, optimized for cloud-native storage. Used for efficient access to the high-resolution GBR velocity data.
- **xarray:** A Python library that makes working with labeled multi-dimensional arrays simple and efficient. Used in conjunction with Zarr for handling the GBR velocity data.
- **Flask-Compress:** Compresses Flask responses with gzip.

### Frontend (JavaScript, HTML, CSS)

- **Mapbox GL JS:** A JavaScript library for vector maps on the web, providing interactive and customizable maps for visualizing particle trajectories.
- **HTML/CSS:** Standard web technologies for structuring and styling the application's user interface.
- **JavaScript:** Powers the interactive elements, map controls, and client-side data handling.

## Data Sources

- **Australia-wide Simulation:** Uses OSCAR (Ocean Surface Current Analyses Real-time) velocity data.
- **Great Barrier Reef Simulation:** Uses high-resolution eReefs velocity data (stored in Zarr format).
- **Reef Locations:** GeoJSON files containing reef coordinates are displayed on the maps.

## Setup and Running

1.  **Navigate to the application directory:**
    ```bash
    cd lagrangian_6Aug/
    ```

2.  **Install Python dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

3.  **Run the Flask application:**
    ```bash
    python app.py
    ```

4.  **Access the application:**
    Open your web browser and navigate to `http://127.0.0.1:5000/` (or the address shown in your terminal).
