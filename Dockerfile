# # Build image
# FROM node:14.17.0-alpine3.13 AS build

# WORKDIR /app

# # Install dependencies
# COPY package.json yarn.lock ./
# RUN yarn install --frozen-lockfile

# # Build the Next.js application
# COPY . .
# RUN yarn build

# # Production image
# FROM nginx:1.21.1-alpine

# # Copy Nginx configuration file
# COPY nginx.conf /etc/nginx/nginx.conf

# # Copy the built application
# COPY --from=build /app/out /usr/share/nginx/html

# # Expose the HTTP port
# EXPOSE 80

# # Start Nginx
# CMD ["nginx", "-g", "daemon off;"]


# Build stage
# FROM node:14-alpine AS build
# FROM node:14.17.0-alpine3.13 AS build
# WORKDIR /app
# COPY package*.json ./
# RUN yarn install --production
# COPY . .
# RUN yarn run build

# # Production stage
# # FROM node:14-alpine
# FROM node:14.17.0-alpine3.13
# WORKDIR /app
# COPY package*.json ./
# RUN yarn install --production
# COPY --from=build /app/.next ./.next
# COPY public ./public
# CMD ["yarn", "start"]

# FROM node:14.17.0-alpine3.13
FROM node:14.21-alpine
WORKDIR /app
COPY package*.json ./
RUN yarn install
COPY . .
# RUN yarn run build
CMD ["yarn", "dev"]
