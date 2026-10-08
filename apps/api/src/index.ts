export default {
  async fetch(): Promise<Response> {
    return Response.json({ ok: true, service: 'maunedas' });
  },
} satisfies ExportedHandler<Env>;
