#!/bin/bash
# Check for #[contractevent] usage outside arenax-events
VIOLATIONS=$(grep -r '#\[contractevent' contracts/ --include="*.rs" -l | grep -v 'contracts/arenax-events/')

if [ -n "$VIOLATIONS" ]; then
    echo "ERROR: #[contractevent] found outside contracts/arenax-events/:"
    echo "$VIOLATIONS"
    echo ""
    echo "All event definitions must be in the arenax-events shared crate."
    echo "See docs/event-versioning.md for details."
    exit 1
fi

echo "OK: All #[contractevent] definitions are in arenax-events"
