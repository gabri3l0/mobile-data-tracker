"""Print a random API key without saving it to disk."""

import argparse
import secrets


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    print(secrets.token_urlsafe(32))


if __name__ == "__main__":
    main()
