/** `GET /v1/me` (03 §5): who is signed in and what the server expects of clients. */
export interface MeResponse {
  user: {
    id: string;
    username: string;
    display_name: string;
    role: 'admin' | 'member';
    has_google: boolean;
  };
  server_time: number;
  schema_version: number;
  min_client_schema: number;
}
