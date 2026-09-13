// Public values only (3. Options, H2 plan item 3): the Supabase project URL and anon key are meant
// to ship in every client; every table is behind row-level security and every function checks the
// session. The VAPID public key only lets this browser subscribe to pushes from this backend.
window.PLANNER_CONFIG = {
  supabaseUrl: "https://wtfbgkyncffvtzacqqng.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZmJna3luY2ZmdnR6YWNxcW5nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3OTg2ODYsImV4cCI6MjEwNDM3NDY4Nn0.1s23flYZAqbLLuGajI_EeAVD6lqkDBO8FNyxdSA9ibM",
  vapidPublicKey: "BLViQpWj6244b8N2fFK9JlMCYa5B4VwPHpP-u7g9HOeLnXBr3_X6Tgtb2mk1zDNpriO_WMNRN7xzHT9eN0_9ltY",
  appPath: "/planner-app/",
};
