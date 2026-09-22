ARG LITELLM_IMAGE=ghcr.io/berriai/litellm:v1.99.1
FROM ${LITELLM_IMAGE} AS hook-dependencies
USER root
COPY shared/requirements.txt /opt/litellm-hooks/requirements.txt
RUN python -m ensurepip && python -m pip install --no-cache-dir --target /opt/hook-vendor -r /opt/litellm-hooks/requirements.txt

# Inherit the original image's runtime user; root is used only in the build stage.
FROM ${LITELLM_IMAGE}
COPY --from=hook-dependencies /opt/hook-vendor /opt/litellm-hooks/vendor
ARG PYTHONPATH
ENV PYTHONPATH=/opt/litellm-hooks/vendor:${PYTHONPATH}
COPY shared/proxy_app.py /opt/litellm-hooks/proxy_app.py
COPY shared/auth_dispatch.py /opt/litellm-hooks/auth_dispatch.py
COPY shared/proxy_hooks /opt/litellm-hooks/proxy_hooks
COPY shared/init_database.py shared/schema.sql /opt/litellm-hooks/
COPY custom_auth.py /opt/litellm-hooks/custom_auth.py
ENTRYPOINT ["python", "-m", "uvicorn", "proxy_app:create_app", "--factory", "--app-dir", "/opt/litellm-hooks"]
CMD ["--host", "0.0.0.0", "--port", "9108", "--workers", "2"]
