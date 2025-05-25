# Use an official Node.js runtime as a parent image
# Using LTS (Long Term Support) version is a good practice, e.g., Node 18
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or npm-shrinkwrap.json)
# This step takes advantage of Docker's layer caching.
# These files don't change often, so their layer can be cached.
COPY package*.json ./

# Install app dependencies
# Using "ci" is generally recommended for production builds if you have a package-lock.json
# as it provides reproducible builds.
# --omit=dev ensures that development dependencies are not installed.
RUN npm ci --omit=dev

# Bundle app source
COPY . .

# Make the application's port available to the world outside this container
# Use an environment variable for the port, defaulting to 3000 if not set.
# The actual port will be read from process.env.PORT in app.js
EXPOSE ${PORT:-3000}

# Define environment variables (optional, can be set at runtime)
# ENV NODE_ENV=production # Recommended for production

# Run app.js when the container launches
# The command should be to run your Node.js application.
CMD ["node", "app.js"]
