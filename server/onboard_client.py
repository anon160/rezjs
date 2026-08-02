import sys
from server.database import create_client, init_db

def main():
    """CLI script to onboard a new pilot client company and generate an API key."""
    if len(sys.argv) < 2:
        print("Usage: python3 onboard_client.py <Company Name> [Optional Webhook URL]")
        print("Example: python3 onboard_client.py 'Vanguard Ocean Freight' 'https://vanguard.com/api/webhook'")
        sys.exit(1)

    company_name = sys.argv[1]
    webhook_url = sys.argv[2] if len(sys.argv) > 2 else None

    client, raw_api_key = create_client(company_name, webhook_url)
    
    print("\n=======================================================")
    print(" 🎉 NEW PILOT CLIENT ONBOARDED SUCCESSFULLY!")
    print("=======================================================")
    print(f" 🏢 Company Name:  {client.company_name}")
    print(f" 🆔 Client ID:     {client.client_id}")
    print(f" 🔑 Live API Key:  {raw_api_key}")
    print(f" 🔗 Webhook URL:   {client.webhook_url or 'None (SQLite Sink Only)'}")
    print("=======================================================\n")
    print("⚠️  SAVE THIS API KEY NOW — it is hashed in the database and cannot be recovered.\n")

if __name__ == "__main__":
    main()
