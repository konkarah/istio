FROM node:20-alpine
WORKDIR /app/service
COPY shared/ /app/shared/
COPY api-gateway/package.json ./
RUN npm install
COPY api-gateway/index.js ./
EXPOSE ${PORT:-3000}
CMD ["node", "index.js"]
