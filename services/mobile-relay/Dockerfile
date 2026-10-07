FROM node:22-alpine
WORKDIR /app
RUN npm install --omit=dev --ignore-scripts --save-exact ws@8.22.0
COPY server.cjs ./server.cjs
USER node
EXPOSE 8080
CMD ["node", "server.cjs"]
