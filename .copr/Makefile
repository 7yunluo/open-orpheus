.ONESHELL:
.PHONY: srpm

srpm:
	# Install build dependencies
	dnf -y install cargo rust gcc git
	# Download and install nvm:
	curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
	# in lieu of restarting the shell
	. "$$HOME/.nvm/nvm.sh"
	# Download and install Node.js:
	nvm install 24
	corepack install
	# Install project dependencies
	pnpm install --frozen-lockfile
	# Build native Rust modules (database, ui, window)
	pnpm run build:modules
	# Package app and produce SRPM via electron-forge
	pnpm run make --targets srpm
	# Copy resulting SRPM to the Copr output directory
	find out/make/srpm -name '*.src.rpm' -exec cp {} $(outdir)/ \;
