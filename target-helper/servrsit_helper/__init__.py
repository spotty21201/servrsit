"""ServrSit target helper (T-083, Technical Spec 7.2 and 8). BUILD ONLY.

Not installed on any real server. Runs only for an authenticated SSH request
(the gateway) and for jobs it already accepted (the runner). No listening
port, no polling loop, no model.

Dependencies: the Python 3.12 standard library and Ubuntu-packaged
python3-cryptography (signature checks) and python3-apt (package adapter).
Nothing comes from pip.
"""

HELPER_VERSION = "0.2.0"
"""Reported by query and checked by the controller before it sends an operation."""
