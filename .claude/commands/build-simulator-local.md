# Build for Local iOS Simulator

Run a local EAS build using the `simulator` profile and install it on the booted simulator.

```bash
eas build --platform ios --profile simulator --local --output /tmp/projectxavier-simulator.tar.gz 2>&1
```

After the build completes, install and launch it:

```bash
# Extract the .app bundle from the tar
mkdir -p /tmp/pxsim && tar -xzf /tmp/projectxavier-simulator.tar.gz -C /tmp/pxsim

# Find the .app and install to booted simulator
APP=$(find /tmp/pxsim -name "*.app" | head -1)
xcrun simctl install booted "$APP"
xcrun simctl launch booted com.projectxavier.app
```

Report the simulator name and whether the app launched successfully.
