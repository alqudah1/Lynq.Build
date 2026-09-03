import { neonConfig } from "@neondatabase/serverless";
neonConfig.fetchEndpoint = "http://127.0.0.1:5544";
neonConfig.useSecureWebSocket = false;
neonConfig.poolQueryViaFetch = true;
