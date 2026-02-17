FROM node:20-alpine AS build

WORKDIR /workspace

COPY apps/kifu_ui/package*.json ./apps/kifu_ui/
RUN cd /workspace/apps/kifu_ui && npm ci

COPY apps/kifu_ui ./apps/kifu_ui
COPY apps/assets ./apps/assets

WORKDIR /workspace/apps/kifu_ui

ARG VITE_MAHJONG_API_BASE=/analysis
ENV VITE_MAHJONG_API_BASE=${VITE_MAHJONG_API_BASE}

RUN npm run build

FROM nginx:1.27-alpine

COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/kifu_ui/dist /usr/share/nginx/html

EXPOSE 80
