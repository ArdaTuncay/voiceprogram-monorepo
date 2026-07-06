# Multi-stage build: compiles a Phoenix release in a full Elixir/OTP image,
# then copies just the compiled release into a minimal Debian runtime image.
#
# NOTE: these versions match this project's dev environment (Elixir 1.20.2,
# Erlang/OTP 29) as closely as possible. Verify this exact tag is published
# at https://hub.docker.com/r/hexpm/elixir/tags before building — if not,
# pick the closest available Elixir/OTP/Debian combination.
ARG ELIXIR_VERSION=1.20.2
ARG OTP_VERSION=29.0
ARG DEBIAN_VERSION=bookworm-20250203-slim

ARG BUILDER_IMAGE="hexpm/elixir:${ELIXIR_VERSION}-erlang-${OTP_VERSION}-debian-${DEBIAN_VERSION}"
ARG RUNNER_IMAGE="debian:${DEBIAN_VERSION}"

# ---- Build stage ----
FROM ${BUILDER_IMAGE} AS builder

RUN apt-get update -y && apt-get install -y build-essential git \
    && apt-get clean && rm -f /var/lib/apt/lists/*_*

WORKDIR /app

RUN mix local.hex --force && \
    mix local.rebar --force

ENV MIX_ENV="prod"

# Install deps first so dependency changes, not every code change, bust this layer.
COPY mix.exs mix.lock ./
RUN mix deps.get --only $MIX_ENV
RUN mkdir config

COPY config/config.exs config/${MIX_ENV}.exs config/
RUN mix deps.compile

COPY priv priv
COPY lib lib

RUN mix compile

COPY config/runtime.exs config/
COPY rel rel
RUN chmod +x rel/overlays/bin/*

RUN mix release

# ---- Runtime stage ----
FROM ${RUNNER_IMAGE} AS runner

RUN apt-get update -y && \
    apt-get install -y libstdc++6 openssl libncurses5 locales ca-certificates \
    && apt-get clean && rm -f /var/lib/apt/lists/*_*

RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen

ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8

WORKDIR "/app"
RUN chown nobody /app

ENV MIX_ENV="prod"

# Only the compiled release is copied in — no source, no build tools, no deps cache.
COPY --from=builder --chown=nobody:root /app/_build/${MIX_ENV}/rel/backend ./

USER nobody

# Run database migrations, then start the server — see rel/overlays/bin/.
CMD ["/bin/sh", "-c", "/app/bin/migrate && /app/bin/server"]
