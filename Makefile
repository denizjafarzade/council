ifeq ($(OS),Windows_NT)
VENV_PY := .venv/Scripts/python
else
VENV_PY := .venv/bin/python
endif

.PHONY: install mocks test backend frontend demo

install:
	python -m venv .venv
	$(VENV_PY) -m pip install -r backend/requirements.txt
	cd frontend && npm install

mocks:
	$(VENV_PY) mocks/generate_mock.py

test:
	$(VENV_PY) -m pytest backend/tests -q

backend:
	cd backend && ../$(VENV_PY) -m uvicorn app:app --reload --port 8000

frontend:
	cd frontend && npm run dev

# Stage 4: starts backend in --offline mode plus the frontend.
demo:
	$(MAKE) -j2 backend frontend
