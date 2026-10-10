# The console hierarchy holds everywhere

The admin console has always said that no admin can change the owner's account, or another admin's. The role controls enforced it; the approve/deny control did not, so an admin could deny a privileged account out of the service. Access decisions now answer to the same hierarchy as role changes. Separately, the site's edge was turning API refusals into blank successes: an unauthorized API call came back looking like an empty but successful answer instead of a refusal. Refusals now arrive as refusals.
