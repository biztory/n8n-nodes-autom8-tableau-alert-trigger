# @biztory/n8n-nodes-autom8-tableau-alert-trigger

n8n community node that polls a **Tableau** view or published datasource on a schedule and fires a workflow when a configured condition is met (any rows returned, row count threshold, etc.).

ℹ️ Full documentation: https://biztory.atlassian.net/wiki/spaces/A8/pages/1123254273/n8n+Node

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation, and search for `@biztory/n8n-nodes-autom8-tableau-alert-trigger`.

## Usage

1. Add the **Autom8 Tableau - Data Alert Trigger** node to a new workflow.
2. Configure the Tableau Connected App credentials.
3. Pick a **Source** (View or Datasource) and a **Condition** (Any Rows Returned or Row Count Threshold).
4. The node polls on n8n's standard polling interval and emits rows whenever the condition fires.

## Compatibility

Tested and supported starting with n8n version **2.13.3**.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Full Autom8 documentation](https://biztory.atlassian.net/wiki/spaces/A8/pages/1123254273/n8n+Node)
- [Tableau Connected Apps reference](https://help.tableau.com/current/online/en-us/connected_apps_direct.htm)
- Main repository: https://github.com/biztory/n8n-nodes-autom8