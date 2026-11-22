# Postgres for Huriro: 18.x + pgvector + pgBackRest (§19.3).
# The initdb script provisions huriro_app/huriro_maint passwords and the
# setup-token hash from Docker secrets on first boot — role passwords are
# provision-time secrets, never migration contents (§12.7).
#
# Major-pinned floating tag; production deployment files pin digests (§19.2).
FROM postgres:18-bookworm

RUN apt-get update \
	&& apt-get install -y --no-install-recommends postgresql-18-pgvector pgbackrest \
	&& rm -rf /var/lib/apt/lists/*

COPY 10-huriro-provision.sh /docker-entrypoint-initdb.d/10-huriro-provision.sh

HEALTHCHECK --interval=10s --timeout=3s --retries=10 \
	CMD pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
