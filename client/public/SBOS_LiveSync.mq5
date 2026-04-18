//+------------------------------------------------------------------+
//|  SB-OS Live Sync EA                                              |
//|  Pushes account + open positions to SB-OS every 30 seconds      |
//|  Install: MT5 → File → Open Data Folder → MQL5/Experts          |
//|  Attach to any chart (e.g. XAGUSD M1) — "Allow WebRequest" ON  |
//+------------------------------------------------------------------+
#property strict
#property description "SB-OS Live Sync — pushes account + positions to your command center"

// ─── CONFIG ────────────────────────────────────────────────────────────────
input string  InpEndpoint    = "https://sbaura.up.railway.app/api/trading/broker-sync";
input string  InpSecret      = "";         // Paste your BROKER_SYNC_SECRET here
input int     InpIntervalSec = 30;         // Push interval in seconds
input string  InpEAVersion   = "1.0.0";
// ────────────────────────────────────────────────────────────────────────────

int gTimer = 0;

int OnInit()
{
   if(StringLen(InpSecret) == 0)
   {
      Alert("SB-OS EA: InpSecret is empty. Set BROKER_SYNC_SECRET in EA inputs.");
      return INIT_FAILED;
   }
   EventSetTimer(InpIntervalSec);
   Print("SB-OS Live Sync started. Pushing to: ", InpEndpoint);
   PushSnapshot(); // push immediately on attach
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }

void OnTimer() { PushSnapshot(); }

//+------------------------------------------------------------------+
//|  Build JSON payload and POST to SB-OS                           |
//+------------------------------------------------------------------+
void PushSnapshot()
{
   string payload = BuildPayload();
   if(payload == "") return;

   char   postData[];
   char   result[];
   string resultHeaders;
   StringToCharArray(payload, postData, 0, StringLen(payload));

   string headers = "Content-Type: application/json\r\nX-Broker-Secret: " + InpSecret + "\r\n";

   int res = WebRequest("POST", InpEndpoint, headers, 5000, postData, result, resultHeaders);

   if(res == 200 || res == 201)
      Print("SB-OS sync OK — ", ArraySize(result), " bytes returned");
   else
      Print("SB-OS sync failed — HTTP ", res, " | Error: ", GetLastError());
}

//+------------------------------------------------------------------+
//|  Serialise account info + open positions to JSON                 |
//+------------------------------------------------------------------+
string BuildPayload()
{
   // Account info
   long   login      = AccountInfoInteger(ACCOUNT_LOGIN);
   string name       = AccountInfoString(ACCOUNT_NAME);
   string server     = AccountInfoString(ACCOUNT_SERVER);
   string currency   = AccountInfoString(ACCOUNT_CURRENCY);
   long   leverage   = AccountInfoInteger(ACCOUNT_LEVERAGE);
   double balance    = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity     = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin     = AccountInfoDouble(ACCOUNT_MARGIN);
   double freeMgn    = AccountInfoDouble(ACCOUNT_FREEMARGIN);
   double mgLevel    = AccountInfoDouble(ACCOUNT_MARGIN_LEVEL);
   double profit     = AccountInfoDouble(ACCOUNT_PROFIT);

   string acct = StringFormat(
      "{\"login\":%I64d,\"name\":\"%s\",\"server\":\"%s\",\"currency\":\"%s\","
      "\"leverage\":%I64d,\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,"
      "\"freeMargin\":%.2f,\"marginLevel\":%.2f,\"profit\":%.2f}",
      login, EscapeJson(name), EscapeJson(server), EscapeJson(currency),
      leverage, balance, equity, margin, freeMgn, mgLevel, profit
   );

   // Positions
   int total = PositionsTotal();
   string posArr = "[";
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;

      string sym     = PositionGetString(POSITION_SYMBOL);
      int    type    = (int)PositionGetInteger(POSITION_TYPE);  // 0=buy,1=sell
      double vol     = PositionGetDouble(POSITION_VOLUME);
      double open    = PositionGetDouble(POSITION_PRICE_OPEN);
      double curr    = PositionGetDouble(POSITION_PRICE_CURRENT);
      double sl      = PositionGetDouble(POSITION_SL);
      double tp      = PositionGetDouble(POSITION_TP);
      double pnl     = PositionGetDouble(POSITION_PROFIT);
      double swap    = PositionGetDouble(POSITION_SWAP);
      double comm    = PositionGetDouble(POSITION_COMMISSION);
      long   openTs  = PositionGetInteger(POSITION_TIME);
      string comment = PositionGetString(POSITION_COMMENT);

      // Convert timestamp to ISO string
      MqlDateTime dt;
      TimeToStruct((datetime)openTs, dt);
      string openISO = StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ",
         dt.year, dt.mon, dt.day, dt.hour, dt.min, dt.sec);

      string pos = StringFormat(
         "{\"ticket\":%I64u,\"symbol\":\"%s\",\"type\":\"%s\",\"volume\":%.2f,"
         "\"openPrice\":%s,\"currentPrice\":%s,\"sl\":%s,\"tp\":%s,"
         "\"profit\":%.2f,\"swap\":%.2f,\"commission\":%.2f,"
         "\"openTime\":\"%s\",\"comment\":\"%s\"}",
         ticket, EscapeJson(sym),
         (type == POSITION_TYPE_BUY ? "buy" : "sell"),
         vol,
         DoubleToString(open, 5), DoubleToString(curr, 5),
         DoubleToString(sl, 5),   DoubleToString(tp, 5),
         pnl, swap, comm,
         openISO, EscapeJson(comment)
      );

      if(i > 0) posArr += ",";
      posArr += pos;
   }
   posArr += "]";

   string payload = StringFormat(
      "{\"accountInfo\":%s,\"positions\":%s,\"eaVersion\":\"%s\"}",
      acct, posArr, InpEAVersion
   );
   return payload;
}

//+------------------------------------------------------------------+
//|  Escape a string for JSON (handle quotes and backslashes)        |
//+------------------------------------------------------------------+
string EscapeJson(string s)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\n", "\\n");
   StringReplace(s, "\r", "\\r");
   return s;
}
