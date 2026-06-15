# Aloud "Pontos PDF" exact-compile service — real TeX Live (Overleaf-grade).
# texlive/texlive is the official full TeX Live image (rolling; ~5 GB) and ships Node-less,
# so we install nodejs on top. For a smaller image, swap to a scheme-medium base + the
# thesis's package set (see README), but full guarantees byte-identical Overleaf output.
FROM texlive/texlive:latest

# Node.js runtime for the tiny server (no npm deps needed)
RUN apt-get update && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.js /app/server.js

ENV PORT=8080 TEX_ENGINE=latexmk COMPILE_TIMEOUT_MS=180000 ALLOW_ORIGIN=*
EXPOSE 8080

# Run as the unprivileged user that the texlive image provides
USER 1000:1000
CMD ["node", "/app/server.js"]
