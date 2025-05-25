# Use an official Python runtime as a parent image
FROM python:3.9-slim

# Set the working directory in the container
WORKDIR /app

# Copy the dependencies file to the working directory
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code into the container
COPY app.py .
COPY opnsense_client.py .
COPY templates templates
COPY static static
# Optionally, copy the .env.example for reference within the container
# COPY .env.example .env.example 

# Make port 5000 available to the world outside this container
EXPOSE 5000

# Define default environment variables for Flask
ENV FLASK_APP app.py
ENV FLASK_RUN_HOST 0.0.0.0
# Note: FLASK_DEBUG is not set here for production. 
# It can be set during `docker run -e FLASK_DEBUG=1` for development.

# --- Application specific environment variables ---
# These environment variables are essential for the application to run correctly.
# Refer to .env.example for a template and detailed explanations.
# Set these variables when running the Docker container, e.g., using `docker run -e VAR=value ...`
# or via a .env file with Docker Compose.

# --- Critical Settings ---
# ENV FLASK_APP_SECRET_KEY="your_very_strong_random_secret_key_here" # **REQUIRED** For session security.

# --- Database ---
# ENV DATABASE_URL="sqlite:///instance/app.db" # Default if not set; creates SQLite DB in /app/instance
# Example for PostgreSQL:
# ENV DATABASE_URL="postgresql://user:password@your_postgres_host:5432/your_database_name"

# --- Google OAuth ---
# ENV GOOGLE_OAUTH_CLIENT_ID="your_google_client_id.apps.googleusercontent.com" # **REQUIRED for Google Login**
# ENV GOOGLE_OAUTH_CLIENT_SECRET="your_google_client_secret" # **REQUIRED for Google Login**

# --- OPNsense API ---
# ENV OPNSENSE_BASE_URL="https://your-opnsense-firewall-ip-or-hostname/api" # **REQUIRED for OPNsense features**
# ENV OPNSENSE_API_KEY="your_opnsense_api_key" # **REQUIRED for OPNsense features**
# ENV OPNSENSE_API_SECRET="your_opnsense_api_secret" # **REQUIRED for OPNsense features**


# Run app.py when the container launches
# The default CMD ["flask", "run"] is fine for development.
# For production, you would typically use a Gunicorn CMD:
# CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:app"]
# (Ensure Gunicorn is in requirements.txt if you use this for production)
CMD ["flask", "run"]
