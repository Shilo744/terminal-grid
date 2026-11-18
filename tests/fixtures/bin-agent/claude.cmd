@echo off
echo AGENTARGS: %*
echo AGENTENV PANE=%TG_PANE_ID% PORT=%TG_PORT% DUO=%TG_DUO_ID% END
ping -n 900 127.0.0.1 >nul
