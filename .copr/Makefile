.PHONY: srpm

srpm:
	# Install build dependencies
	dnf -y install rpm-build cargo rust make gcc curl git
	# Fedora 43 ships Node.js 22; install Node.js 24 via NodeSource
	curl -fsSL https://rpm.nodesource.com/setup_24.x | bash -
	dnf -y install nodejs
	# Install pnpm
	npm install -g pnpm
	# Install project dependencies
	pnpm install --frozen-lockfile
	# Build native Rust modules (database, ui, window)
	pnpm run build:modules
	# Package app and produce SRPM via electron-forge
	pnpm run make --targets srpm
	# Copy resulting SRPM to the Copr output directory
	find out/make/srpm -name '*.src.rpm' -exec cp {} $(outdir)/ \;
