# StudioFlow API. Build context: apps/api (docker build apps/api).
# Stage 1 restores and publishes with the SDK; stage 2 runs on the small Alpine ASP.NET runtime as a non-root user.

# Pinned to patch versions (SDK 10.0.402 ships runtime 10.0.13, the version of the referenced ASP.NET Core packages);
# update both together.
FROM mcr.microsoft.com/dotnet/sdk:10.0.402 AS build
WORKDIR /src

# Restore first (cached as long as project files and package versions do not change).
COPY nuget.config Directory.Build.props Directory.Packages.props ./
COPY src/Opten.StudioFlow.Core/Opten.StudioFlow.Core.csproj src/Opten.StudioFlow.Core/
COPY src/Opten.StudioFlow.Infrastructure/Opten.StudioFlow.Infrastructure.csproj src/Opten.StudioFlow.Infrastructure/
COPY src/Opten.StudioFlow.Web/Opten.StudioFlow.Web.csproj src/Opten.StudioFlow.Web/
RUN dotnet restore src/Opten.StudioFlow.Web/Opten.StudioFlow.Web.csproj

COPY src/ src/
# The release workflow passes the commit; the API then reports its version as 0.1.0+1a2b3c4 (GET /api/system/info).
# The version itself is the Version property in Directory.Build.props. Declared this late so that it does not
# invalidate the restore layer.
ARG STUDIOFLOW_REVISION=
# The OpenAPI document is generated at development time (npm run gen:contracts), not in the image.
RUN dotnet publish src/Opten.StudioFlow.Web/Opten.StudioFlow.Web.csproj -c Release -o /app --no-restore \
    -p:UseAppHost=false -p:OpenApiGenerateDocuments=false -p:SourceRevisionId="$STUDIOFLOW_REVISION"

FROM mcr.microsoft.com/dotnet/aspnet:10.0.13-alpine3.24 AS runtime

# Culture data for German (CH) texts (the project does not run in invariant globalization mode) and the Kerberos
# library that Npgsql probes for GSS encryption.
RUN apk add --no-cache icu-libs icu-data-full krb5-libs \
    && mkdir -p /data/media /data/keys \
    && chown -R "$APP_UID:$APP_UID" /data

ENV ASPNETCORE_HTTP_PORTS=8080 \
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=false \
    Media__Path=/data/media \
    DataProtection__KeysPath=/data/keys

WORKDIR /app
COPY --from=build /app .

USER $APP_UID
EXPOSE 8080
VOLUME ["/data/media", "/data/keys"]

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/health/live || exit 1

ENTRYPOINT ["dotnet", "Opten.StudioFlow.Web.dll"]
