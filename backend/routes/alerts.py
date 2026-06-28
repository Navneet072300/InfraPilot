"""Slack interactive button callback handler."""
import json
import logging
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Request

from workers import cluster_monitor

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.post("/slack/action")
async def slack_action(request: Request):
    body = await request.body()
    try:
        payload_str = unquote(body.decode()).replace("payload=", "", 1)
        payload = json.loads(payload_str)
    except Exception:
        raise HTTPException(400, "Invalid Slack payload")

    actions = payload.get("actions", [])
    if not actions:
        return {"text": "OK"}

    action = actions[0]
    action_id = action.get("action_id", "")
    incident_id = action.get("value", "")

    if action_id == "snooze":
        cluster_monitor.snooze_incident(incident_id, minutes=30)
        return {"text": "💤 Snoozed for 30 minutes"}

    if action_id == "fix_auto":
        inc = cluster_monitor.get_incident(incident_id)
        if inc:
            inc["status"] = "fixing"
        return {"text": "🔧 AI fix started…"}

    if action_id == "acknowledge":
        slack_user = payload.get("user", {}).get("name", "slack-user")
        cluster_monitor.acknowledge_incident(incident_id, by=f"@{slack_user}")
        return {"text": f"🙋 Acknowledged by @{slack_user}"}

    return {"text": "OK"}
