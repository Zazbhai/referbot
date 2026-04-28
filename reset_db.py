import os
import sys

try:
    from pymongo import MongoClient
    from dotenv import load_dotenv
except ImportError:
    print("[!] Missing dependencies. Please run:")
    print("pip install pymongo python-dotenv")
    sys.exit(1)

def main():
    # Load environment variables from .env
    load_dotenv()

    uri = os.getenv("MONGODB_URI")
    if not uri:
        print("[!] Error: MONGODB_URI not found in .env file.")
        sys.exit(1)

    client = None
    try:
        # Connect to MongoDB
        print("Connecting to MongoDB...")
        client = MongoClient(uri)
        
        # Try to extract DB name from URI
        db_name = ""
        if "/" in uri.split("://")[1]:
            path_part = uri.split("://")[1].split("/", 1)[1]
            db_name = path_part.split("?")[0]

        if not db_name:
            db_name = "test" # Default MongoDB/Mongoose database
            print(f"[!] No database name found in URI, defaulting to '{db_name}'")

        print(f"\n{'='*40}")
        print(f" DATABASE RESET UTILITY")
        print(f"{'='*40}")
        print(f"Target Database: {db_name}")
        print(f"Cluster:         {uri.split('@')[-1].split('/')[0]}")
        
        print(f"\n[!] WARNING: This will PERMANENTLY DELETE all collections and data in '{db_name}'.")
        confirm = input("Are you sure? (type 'yes' to confirm): ")
        
        if confirm.lower() != 'yes':
            print("\nOperation cancelled.")
            sys.exit(0)

        # Drop the entire database
        print(f"\nDropping database '{db_name}'...")
        client.drop_database(db_name)
        
        print(f"Successfully cleared all data in '{db_name}'!")
        print("\nNext steps:")
        print("1. Restart your Node.js server: npm run dev")
        print("2. The server will automatically re-seed default categories on startup.")

    except Exception as e:
        print(f"\nAn error occurred: {e}")
        sys.exit(1)
    finally:
        if client:
            client.close()

if __name__ == "__main__":
    main()
