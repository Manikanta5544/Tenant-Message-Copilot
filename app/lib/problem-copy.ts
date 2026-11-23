/** Plain-language copy for every error code the API (or a server page) can answer with: what happened, and what to do. */
export interface ProblemCopy { title: string; what: string; todo: string }

export const PROBLEM_COPY: Record<string, ProblemCopy> = {
  config_missing: { title: "The service is not configured", what: "A required setting is missing, so the app cannot reach its database.", todo: "Create .env from .env.example, set the missing variables, save it, then stop and restart npm run dev (Next.js reads .env only at start) and press Check again." },
  schema_out_of_date: { title: "The database needs an update", what: "The database is behind this version of the app.", todo: "Run npm run migrate and npm run seed, then press Check again." },
  database_unreachable: { title: "The database is not reachable", what: "Nothing is answering at the database address.", todo: "Start Postgres (docker compose up -d) or point DATABASE_URL_* at a Neon database, then press Check again." },
  database_auth_failed: { title: "The database refused the login", what: "The app role copilot_app could not log in.", todo: "Run npm run migrate, and check that APP_ROLE_PASSWORD matches the password in DATABASE_URL_APP." },
  database_missing: { title: "The database does not exist", what: "The server is running but has no database with the name in the URL.", todo: "Create it, or fix the database name in DATABASE_URL_OWNER and DATABASE_URL_APP." },
  database_error: { title: "The database connection failed", what: "The connection broke for a reason the app could not classify.", todo: "Run npm run doctor for details, then press Check again." },
  provider_unavailable: { title: "The model is unavailable", what: "The language model did not answer, so a safe holding reply is shown and a person must handle the message.", todo: "Run npm run doctor to check the key, model names and rate limits." },
  rate_limited: { title: "Slow down for a moment", what: "This demo limits how many drafts one visitor can generate per hour.", todo: "Try again after the time shown in the message; reading existing drafts is not limited." },
  budget_exhausted: { title: "Today's demo limit is reached", what: "The shared daily run or spending cap is used up.", todo: "It resets at 00:00 UTC. Existing drafts stay readable." },
  maintenance: { title: "The service is in maintenance", what: "The server is misconfigured for this environment (for example mock mode in production).", todo: "Check the server log and /api/ready, fix the setting, and redeploy." },
  unexpected: { title: "Something went wrong", what: "An unexpected error occurred. Nothing was sent to the tenant.", todo: "Quote the reference below if it keeps happening." },
};
export const copyFor = (code?: string): ProblemCopy => PROBLEM_COPY[code ?? "unexpected"] ?? PROBLEM_COPY.unexpected!;
