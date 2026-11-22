FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY BoosterApi.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
# Vercel envoie le trafic sur le port 80 (modifiable avec la variable PORT)
ENV PORT=80
ENTRYPOINT ["dotnet", "BoosterApi.dll"]
