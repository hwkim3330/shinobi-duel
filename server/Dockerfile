# Hugging Face Space (Docker SDK): the built game + the lobby / signaling / relay server on :7860.
# tools/deploy-hf.sh builds dist/ locally and uploads it with this file at the Space root.
FROM node:22-slim
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/server.mjs ./server/
COPY dist ./dist
ENV PORT=7860 DIST=/app/dist
EXPOSE 7860
USER node
CMD ["node", "server/server.mjs"]
