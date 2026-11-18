FROM node:22-alpine
WORKDIR /app
COPY package.json server.js db.js wards.js ./
COPY public ./public
COPY data/officials.json data/ward-people.json data/wards.geojson data/assembly.geojson data/changelog.json ./data/
# Set ADMIN_PASSCODE, DATA_PASSCODE and TOKEN_SECRET as environment variables on your host.
ENV PORT=8080 DB_PATH=/data/kachra.db UPLOADS_DIR=/data/uploads
EXPOSE 8080
CMD ["node", "--no-warnings", "server.js"]
