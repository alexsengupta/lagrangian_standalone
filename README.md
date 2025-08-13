# Lagrangian Particle Simulation App

This application provides interactive web-based simulations of ocean particle trajectories for two distinct regions: Australia-wide and the Great Barrier Reef (GBR).

## Features

-   **Dual Simulation Modes:** Choose between a broad Australia-wide simulation and a higher-resolution Great Barrier Reef specific simulation.
-   **Interactive Map:** Visualize particle movements on a Mapbox GL JS map.
-   **Parameter Selection:** Users can select various simulation parameters, including:
    -   Release location (latitude and longitude)
    -   Number of particles
    -   Release area
    -   Simulation duration
    -   Timestep
    -   Simulation direction (forwards or backwards in time)
-   **Visualization Controls:** Control playback of simulations with manual time sliders, full trajectory views, and animation modes.
-   **Data Integration:** Seamlessly integrates with ocean velocity data and reef location data.

## Technologies Used

### Backend (Python)

-   **Flask:** A micro web framework for Python, used to serve the web application and handle simulation logic.
-   **Gunicorn:** A production-grade WSGI server used to run the Flask application.
-   **Nginx:** A high-performance reverse proxy used to manage web traffic and serve static files.
-   **NumPy:** Fundamental package for numerical computing in Python, used for array operations.
-   **SciPy:** Used for scientific computing, specifically for interpolating ocean velocity data.
-   **netCDF4:** Used for reading the OSCAR velocity data for the Australia-wide simulation.
-   **Zarr:** A library for chunked, compressed, N-dimensional arrays, used for the high-resolution GBR velocity data.
-   **Flask-Compress:** Compresses Flask responses with gzip.

### Frontend (JavaScript, HTML, CSS)

-   **Mapbox GL JS:** A JavaScript library for vector maps on the web.
-   **HTML/CSS/JavaScript:** Standard web technologies for the user interface and client-side logic.

## Data Sources

-   **Australia-wide Simulation:** Uses OSCAR (Ocean Surface Current Analyses Real-time) velocity data.
-   **Great Barrier Reef Simulation:** Uses high-resolution eReefs velocity data (stored in Zarr format).
-   **Reef Locations:** GeoJSON files containing reef coordinates are displayed on the maps.

---

## Setup and Deployment

This guide covers two scenarios: running the app locally for development and deploying it to a production environment on the Nectar Research Cloud.

### Section 1: Local Development Setup

Follow these steps to run the application on your local machine for testing and development.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/alexsengupta/lagrangian_standalone.git
    cd lagrangian_standalone/
    ```

2.  **Install Python dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

3.  **Run the Flask application:**
    The application needs to be configured to listen on all interfaces. Make sure the last lines of `app.py` are:
    ```python
    if __name__ == '__main__':
        app.run(debug=True, host='0.0.0.0', port=5000)
    ```
    Then, run the app:
    ```bash
    python3 app.py
    ```

4.  **Access the application:**
    Open your web browser and navigate to `http://127.0.0.1:5000/`.

---

### Section 2: Production Deployment on Nectar Research Cloud

These instructions detail how to deploy the application on a Nectar virtual machine using Gunicorn and Nginx.

#### Step 1: Create a Nectar Instance

1.  **Log in to Nectar Dashboard:** Go to [https://cloud.nectar.org.au/](https://cloud.nectar.org.au/) and log in.
2.  **Navigate to Instances:** On the left panel, go to `Compute > Instances`.
3.  **Launch Instance:** Click the "Launch Instance" button.
4.  **Details Tab:**
    *   **Instance Name:** Enter a name (e.g., `LagrangianApp-Prod`).
    *   **Count:** `1`.
5.  **Source Tab:**
    *   **Select Boot Source:** `Image`.
    *   **Image Name:** Select `Ubuntu 22.04 LTS`.
6.  **Flavor Tab:**
    *   **Flavor:** Select `m3.medium` (4 vCPUs, 8 GB RAM, 30 GB Disk) or a similar flavor.
7.  **Networks Tab:**
    *   Confirm your project's primary network (e.g., `Classic Provider`) is in the "Allocated" list. A public IP should be assigned automatically upon launch.
8.  **Security Groups Tab:**
    *   Create a new Security Group named `LagrangianApp-SG` (this may need to be done from `Networking > Security Groups` before launching).
    *   Add the following **Ingress** rules to it:
        *   `SSH` (port 22) from `0.0.0.0/0`
        *   `HTTP` (port 80) from `0.0.0.0/0`
        *   `HTTPS` (port 443) from `0.0.0.0/0`
        *   `Custom TCP Rule` on port `5000` from `0.0.0.0/0` (for direct Gunicorn access during testing)
    *   In the wizard, remove the `default` security group and allocate your new `LagrangianApp-SG`.
9.  **Key Pair Tab:**
    *   Select or create an SSH key pair. Download the `.pem` file and keep it secure.
10. **Launch Instance:**
    *   Click the "Launch Instance" button. Once active, note the **Public IP Address**.

#### Step 2: Connect and Prepare the Server

1.  **Connect via SSH:**
    ```bash
    # Replace with your key file and public IP
    ssh -i /path/to/your/key.pem ubuntu@YOUR_PUBLIC_IP
    ```
2.  **Update the Server:**
    ```bash
    sudo apt update
    sudo apt upgrade -y
    ```
3.  **Install Required Tools:**
    ```bash
    sudo apt install python3 python3-pip git nginx -y
    ```
4.  **Reboot (if prompted by a kernel upgrade):**
    ```bash
    sudo reboot
    ```
    Wait a minute, then reconnect via SSH.

#### Step 3: Clone Application and Install Dependencies

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/alexsengupta/lagrangian_standalone.git
    cd lagrangian_standalone/
    ```
2.  **Install Python dependencies:**
    ```bash
    pip install -r requirements.txt
    pip install gunicorn # Also install Gunicorn
    ```
3.  **Add Gunicorn to your PATH:**
    ```bash
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.profile
    source ~/.profile
    ```

#### Step 4: Configure Nginx as a Reverse Proxy

1.  **Create an Nginx configuration file:**
    ```bash
    sudo nano /etc/nginx/sites-available/lagrangian_app
    ```
2.  **Paste the following configuration**, replacing `YOUR_PUBLIC_IP` with your instance's IP:
    ```nginx
    server {
        listen 80;
        server_name YOUR_PUBLIC_IP;

        location /lagrangian_6Aug/static/ {
            alias /home/ubuntu/lagrangian_standalone/static/;
            expires 30d;
            add_header Cache-Control "public, no-transform";
        }

        location / {
            proxy_pass http://127.0.0.1:5000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
    ```
3.  **Enable the new configuration:**
    ```bash
    sudo ln -s /etc/nginx/sites-available/lagrangian_app /etc/nginx/sites-enabled/
    sudo rm /etc/nginx/sites-enabled/default
    ```
4.  **Test and restart Nginx:**
    ```bash
    sudo nginx -t
    sudo systemctl restart nginx
    ```

#### Step 5: Create a Systemd Service for Gunicorn

1.  **Create the service file:**
    ```bash
    sudo nano /etc/systemd/system/lagrangian_app.service
    ```
2.  **Paste the following configuration:**
    ```ini
    [Unit]
    Description=Gunicorn instance to serve the Lagrangian Particle App
    After=network.target

    [Service]
    User=ubuntu
    Group=www-data
    WorkingDirectory=/home/ubuntu/lagrangian_standalone
    Environment="PATH=/home/ubuntu/.local/bin"
    ExecStart=/home/ubuntu/.local/bin/gunicorn --workers 4 --bind 127.0.0.1:5000 app:app
    Restart=always

    [Install]
    WantedBy=multi-user.target
    ```
3.  **Start and enable the service:**
    ```bash
    sudo systemctl start lagrangian_app
    sudo systemctl enable lagrangian_app
    ```

#### Step 6: Accessing the Live Application

Your application is now running as a background service. You can access it in your web browser by navigating to:
`http://YOUR_PUBLIC_IP`

### Section 3: Managing the Live Application

Once deployed, you can manage the application using `systemd`.

-   **Check the status:**
    ```bash
    sudo systemctl status lagrangian_app
    ```
    (Press `q` to exit the status view)

-   **Restart the app (after making code changes):**
    ```bash
    sudo systemctl restart lagrangian_app
    ```

-   **Stop the app:**
    ```bash
    sudo systemctl stop lagrangian_app
    ```

-   **View logs:**
    ```bash
    journalctl -u lagrangian_app -f
    ```
    (The `-f` flag will "follow" the logs in real-time. Press `Ctrl+C` to exit.)

---

## Performance & Deployment Notes (Aragonite app)

These notes describe the small, high-impact changes applied and recommended runtime settings to reduce latency for the Aragonite visualization.

1) Key runtime dependencies
- Ensure `Flask-Compress` and `gunicorn` are included in `requirements.txt` (they are already added).
- `orjson` is optional and useful in later stages for faster JSON serialization if you choose to switch.

2) Server-side compression
- The app uses Flask-Compress to enable gzip compression of responses. This significantly reduces transfer size for large JSON payloads (e.g., `/aragonite/api/slice`).
- If you front the app with Nginx, enable gzip (and optionally brotli) in your Nginx config for additional savings:
  ```
  gzip on;
  gzip_types application/json application/javascript text/css text/plain;
  brotli on;
  brotli_types application/json application/javascript text/css text/plain;
  ```

3) Preloading datasets to reduce per-worker cold start
- Start Gunicorn with the `--preload` option so the master process loads the NetCDF / CO2 datasets once before forking workers. Child workers inherit memory (copy-on-write), avoiding repeated disk reads and per-worker initialization delays:
  ```
  gunicorn 'app:app' -w 2 -k gthread --threads 8 --preload --timeout 60 --keep-alive 75
  ```
  - Adjust worker and thread counts to match your Nectar VM CPU/RAM.

4) Caching headers
- Several API endpoints now include Cache-Control headers so CDNs, reverse proxies, and browsers can cache responses:
  - `/aragonite/api/meta`, `/aragonite/api/co2_data`, `/aragonite/api/reefs` — Cache-Control: public, max-age=86400
  - `/aragonite/api/slice` — Cache-Control: public, max-age=31536000, immutable

5) Reduced JSON payload size for slices
- `/aragonite/api/slice` now quantizes numeric values to 3 decimal places before JSON serialization which, when combined with gzip, reduces payload size substantially.

6) Client-side improvements
- The client parallelizes initial fetches (metadata, land, CO2, reefs), reducing time-to-first-render.
- The client prefers a local `static/land_simple.geojson` (if present) to avoid the external GitHub request; add this file to the `static/` folder for best results.

7) Recommended static file and CDN settings
- Serve `static/` via Nginx with long cache headers:
  ```
  location /lagrangian_6Aug/static/ {
      alias /home/ubuntu/lagrangian_standalone/static/;
      expires 30d;
      add_header Cache-Control "public, immutable";
  }
  ```
- Consider putting large static data (pre-baked slices, land_simple.geojson) behind a CDN or object store.

8) Verification checklist (quick)
- Start the app (Gunicorn or Flask).
- In browser DevTools > Network:
  - Confirm `/aragonite/api/slice` responses have `Content-Encoding: gzip`.
  - Confirm `Cache-Control` headers present on `/api/meta`, `/api/co2_data`, `/api/reefs`, `/api/slice`.
  - Ensure initial network requests are parallel (Promise.all) and first paint completes faster.

9) Further optimizations (if needed)
- Serve typed-array binary payloads (Float32) for slices to reduce size and parsing cost client-side.
- Precompute and serve compressed slice files or tiles.
- Use Zarr chunked reads or an object store if memory is constrained.

---

cd /home/ubuntu/lagrangian_standalone/
git status
git add .
git commit -m "Deploy to Nectar, fix static files, and add CSV export"
git push

username:alexsengupta 
password: token
