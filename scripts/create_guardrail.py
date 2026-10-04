"""Create (or reuse) Verdisk's Bedrock compliance guardrail and print the .env lines for it.

    python scripts/create_guardrail.py        # needs AWS credentials and AWS_REGION

Denied topics: personalised buy/sell advice and political commentary. Bedrock's content
filters have no "political" category, so politics is a denied topic, defined narrowly so
neutral analysis of central banks and policy still passes. Content filters catch hate,
insults, violence and misconduct. Re-running reuses the guardrail and publishes a new version.
"""

import os
import sys
from pathlib import Path

import boto3
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)

NAME = "verdisk-compliance"
BLOCKED = ("Withheld by Verdisk's compliance guardrail: this read as personal investment advice or "
           "political commentary. Verdisk gives research, not recommendations.")

TOPICS = [
    {
        "name": "Personalised investment advice",
        "definition": ("Telling the reader to buy, sell or hold a specific security, fund or asset, when to trade, "
                       "or how much of their own money to put into it."),
        "examples": [
            "You should buy HSBC shares now.",
            "Sell your Japanese bank stocks before Friday.",
            "Put 20% of your savings into US tech.",
            "I recommend going long the Hang Seng this week.",
            "Load up on Tokyo Electron before earnings.",
        ],
        "type": "DENY",
    },
    {
        "name": "Political commentary",
        "definition": ("Opinions about political parties, politicians, elections or a government's legitimacy, or "
                       "partisan language about countries. Neutral analysis of central bank or fiscal policy is allowed."),
        "examples": [
            "This government is corrupt and should be voted out.",
            "Only a fool would back that party.",
            "That regime does not deserve to exist.",
            "The president is an idiot for this policy.",
        ],
        "type": "DENY",
    },
]

FILTERS = [
    {"type": t, "inputStrength": "MEDIUM", "outputStrength": "MEDIUM"}
    for t in ("HATE", "INSULTS", "VIOLENCE", "MISCONDUCT", "SEXUAL")
]


def main() -> None:
    region = os.getenv("AWS_REGION")
    if not region:
        sys.exit("Set AWS_REGION (and AWS credentials) in .env first.")
    bedrock = boto3.client("bedrock", region_name=region)

    existing = next((g for g in bedrock.list_guardrails()["guardrails"] if g["name"] == NAME), None)
    config = dict(
        name=NAME,
        description="Verdisk: block personalised buy/sell advice and political commentary in council output.",
        topicPolicyConfig={"topicsConfig": TOPICS},
        contentPolicyConfig={"filtersConfig": FILTERS},
        blockedInputMessaging=BLOCKED,
        blockedOutputsMessaging=BLOCKED,
    )
    if existing:
        guardrail_id = existing["id"]
        bedrock.update_guardrail(guardrailIdentifier=guardrail_id, **config)
        print(f"Updated guardrail {NAME} ({guardrail_id})")
    else:
        guardrail_id = bedrock.create_guardrail(**config)["guardrailId"]
        print(f"Created guardrail {NAME} ({guardrail_id})")

    version = bedrock.create_guardrail_version(guardrailIdentifier=guardrail_id,
                                               description="Verdisk compliance layer")["version"]
    print(f"Published version {version}. Add to .env:\n")
    print(f"GUARDRAIL_ID={guardrail_id}")
    print(f"GUARDRAIL_VERSION={version}")


if __name__ == "__main__":
    main()
