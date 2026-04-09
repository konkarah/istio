FROM node:20-alpine
WORKDIR /app/service
COPY shared/ /app/shared/
COPY user-service/package.json ./
RUN npm install
COPY user-service/index.js ./
EXPOSE ${PORT:-3000}
CMD ["node", "index.js"]
