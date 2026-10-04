ifeq ($(OS),Windows_NT)
VENV_PY := .venv/Scripts/python
else
VENV_PY := .venv/bin/python
endif

.PHONY: install mocks test keys backend frontend demo record

install:
	python -m venv .venv
	$(VENV_PY) -m pip install -r backend/requirements.txt
	cd frontend && npm install

mocks:
	$(VENV_PY) mocks/generate_mock.py

keys:
	$(VENV_PY) backend/check_keys.py

test:
	$(VENV_PY) -m pytest backend/tests -q

backend:
	cd backend && ../$(VENV_PY) -m uvicorn app:app --reload --port 8000

frontend:
	cd frontend && npm run dev

# Stage 4: backend in offline mode (recorded runs, cached data) plus the frontend.
demo:
	$(VENV_PY) scripts/demo.py

# Stage 4: pre-record the 4 preset events into runs/ (real LLM calls, costs credits).
record:
	$(VENV_PY) scripts/record_presets.py
