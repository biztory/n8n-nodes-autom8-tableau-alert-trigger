# @biztory/n8n-nodes-autom8-tableau-alert-trigger

n8n community node that polls a **Tableau** view or published datasource on a schedule and fires a workflow when a configured condition is met (any rows returned, row count threshold, etc.).

📚 Full documentation: https://biztory.atlassian.net/wiki/spaces/A8/pages/1123254273/n8n+Node
ℹ️ More information: https://autom8.biztory.com

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation, and search for `@biztory/n8n-nodes-autom8-tableau-alert-trigger`.

## Authentication

This node authenticates using a **Tableau Connected App** (Direct Trust). Connected Apps let a service account sign JWT tokens instead of using a stored password.

### 1. Create a Connected App in Tableau

1. In Tableau Cloud or Tableau Server, go to **Settings → Connected Apps**.
2. Click **New Connected App → Direct Trust**.
3. Give it a name (e.g. *n8n integration*) and click **Save**.
4. Open the Connected App and click **Generate New Secret**.
5. Copy and store the **Client ID**, **Secret ID**, and **Secret Value** — the secret value is only shown once.

### 2. Configure the credential in n8n

Add a new **Autom8 Tableau Connected App** credential and fill in the following fields:

| Field | Description |
|---|---|
| **Server URL** | Base URL of your Tableau instance, e.g. `https://prod-useast1.online.tableau.com` |
| **Site Content URL** | The site name that appears in your Tableau URLs. Leave empty for the Default site. |
| **API Version** | Tableau REST API version, e.g. `3.23`. Check your Tableau release notes for the supported version. |
| **Client ID** | From the Connected App overview page. |
| **Secret ID** | From the generated secret. |
| **Secret Value** | From the generated secret (shown only at creation time). |
| **Username** | The Tableau username (email) the node will impersonate when querying data. |
| **Scopes** | Space-separated JWT scopes. Use `tableau:views:download` for the View source, `tableau:viz_data_service:read` for the Datasource source, or both. |

## Usage

1. Add the **Autom8 Tableau - Data Alert Trigger** node to a new workflow.
2. Select the credential you created above.
3. Pick a **Source** (View or Datasource) and a **Condition** (Any Rows Returned or Row Count Threshold).
4. The node polls on n8n's configured polling interval and emits items whenever the condition is met.

### Finding a View ID or Datasource ID

The **View ID** and **Datasource ID** fields expect the object's LUID — the UUID-style identifier visible in the Tableau REST API and in the object's URL on Tableau Server/Cloud.

## Example: alert when open support tickets exceed a threshold

**Scenario**: A Tableau view is pre-filtered to show only open support tickets. The workflow should fire and post a Slack message whenever that count exceeds 50.

**Trigger node configuration:**

| Setting | Value |
|---|---|
| Source | View |
| View ID | *(LUID of your "Open Tickets" view)* |
| Condition | Row Count Threshold |
| Operator | > (Greater Than) |
| Threshold | `50` |
| Emit | Single Summary Item |

**The trigger emits one item** with the shape:

```json
{
  "row_count": 63,
  "triggered_at": "2025-06-01T09:15:00.000Z",
  "source": "view",
  "rows": [ ... ]
}
```

Connect a **Slack** node after the trigger and reference `{{ $json.row_count }}` in the message body:

> ⚠️ *63 open support tickets* — threshold of 50 exceeded. [View in Tableau →]

## Compatibility

Tested and supported starting with n8n version **2.18.5**.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Full Autom8 documentation](https://biztory.atlassian.net/wiki/spaces/A8/pages/1123254273/n8n+Node)
- [Tableau Connected Apps reference](https://help.tableau.com/current/online/en-us/connected_apps_direct.htm)
- Main repository: https://github.com/biztory/n8n-nodes-autom8