# Collectors keep their idle fallback during the check-in change

Collectors now check in and the door answers with the next interval instead of holding a poll open. One released Python collector still expected the earlier idle fallback in its configuration, so the door keeps sending that compatible value while it also sends the check-in interval. Collection and the shared rate budget are unchanged.
