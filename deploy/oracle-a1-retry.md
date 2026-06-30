# Auto-grab a free Oracle A1 (ARM) box from your GCP server

Oracle's free Ampere A1 is chronically "out of host capacity" — it frees up in unpredictable bursts,
often in the small hours of your region's night. Since your own devices are off then, this runs the
retry loop on your **always-on GCP e2-micro**, so it keeps trying 24/7 and stops the moment it lands
an instance.

Do this **after** the GCP box is up and running lifeOS (you'll already have Node, pm2, etc. there).

---

## 1. Install the OCI CLI on the GCP box

```bash
bash -c "$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)"
exec $SHELL          # reload PATH so `oci` is found
oci --version        # confirm
```

## 2. Authenticate it (API key)

```bash
oci setup config
```

It asks for, in order:
- **User OCID** — Oracle console → profile icon (top-right) → **My profile** → copy **OCID**.
- **Tenancy OCID** — profile menu → **Tenancy: …** → copy **OCID**. (This is also your
  `COMPARTMENT_OCID`.)
- **Region** — e.g. `ap-singapore-1` (shown in the console's top bar).
- **Generate a new API Signing key?** → **Y**. Accept the default paths.

Then upload the public key it generated to Oracle:
- Console → **My profile → API keys → Add API key → Paste public key**.
- Paste the contents of `~/.oci/oci_api_key_public.pem`:
  ```bash
  cat ~/.oci/oci_api_key_public.pem
  ```
- Add it, then test:
  ```bash
  oci iam region list --output table     # should print regions, not an auth error
  ```

## 3. Make the SSH key the A1 will use

```bash
ssh-keygen -t ed25519 -f ~/.ssh/oracle_a1 -N ""
```

The grabber injects `~/.ssh/oracle_a1.pub` into the new instance. You'll SSH into the A1 **from the
GCP box** with the matching private key (`ssh -i ~/.ssh/oracle_a1 ubuntu@<A1_IP>`), or copy that key
to your PC later.

## 4. Discover the OCIDs and fill the env file

Set a shell var for your tenancy/compartment first (paste your tenancy OCID):

```bash
C=ocid1.tenancy.oc1..xxxxxxxx

# Availability domain name(s):
oci iam availability-domain list --compartment-id "$C" --query 'data[*].name' --output table

# Public subnet OCID (from the VCN you made in the console):
oci network subnet list --compartment-id "$C" \
  --query 'data[?contains("display-name",`subnet`)].{name:"display-name",id:id,public:"prohibit-public-ip-on-vnic"}' \
  --output table
# pick the one with public=false (public IPs allowed).

# Latest aarch64 Ubuntu 22.04 image OCID (ARM — for A1):
oci compute image list --compartment-id "$C" \
  --operating-system "Canonical Ubuntu" --operating-system-version "22.04" \
  --shape "VM.Standard.A1.Flex" \
  --query 'data[0].id' --raw-output
```

Now create and fill the env file:

```bash
cd ~/lifeOS
cp deploy/oracle-a1.env.example deploy/oracle-a1.env
nano deploy/oracle-a1.env     # paste the 4 OCIDs/names + your SSH_PUBKEY_PATH (/home/<you>/.ssh/oracle_a1.pub)
```

## 5. Run it under pm2 (survives GCP reboots, easy logs)

```bash
cd ~/lifeOS
pm2 start deploy/oracle-a1-retry.sh --name a1-grabber --interpreter bash --no-autorestart
pm2 save
pm2 logs a1-grabber        # watch the attempts
```

`--no-autorestart` matters: the script loops internally on "no capacity" and only **exits when it
succeeds** (or on a real auth/quota error). You don't want pm2 relaunching it after a successful grab.

## 6. When it lands one

You'll see `🎉 SUCCESS` in the logs and a `deploy/a1-success.json` file. Then:

1. Console → **Compute → Instances** → your new `lifeos-a1` → copy its **public IP**.
2. From the GCP box: `ssh -i ~/.ssh/oracle_a1 ubuntu@<A1_IP>`
3. Run the **same** lifeOS setup on it (`scp` the tarball or `git clone`, then `bash deploy/setup.sh`,
   `claude` login, Tailscale, Syncthing, pm2) — it's identical to the GCP steps.
4. Once the A1 is serving and synced, retire the GCP instance if you want (or keep it as the
   always-on grabber/backup). `pm2 delete a1-grabber` on GCP when you're done.

---

### Notes / gotchas

- **Pacing:** 180 s between tries is gentle on Oracle's rate limit. If you still see `429`, raise
  `RATE_SLEEP_SECONDS`. Hammering faster does **not** help — capacity is the bottleneck, not speed.
- **Sizing:** if days pass with no luck, try `OCPUS=1 / MEM_GB=6` in the env — a smaller slice
  sometimes fits where 2/12 won't.
- **Quota stop (exit 2):** means you already hold an A1 or used the free allotment — check Instances.
- **Auth stop (exit 3):** re-run `oci iam region list`; fix `~/.oci/config` / the uploaded API key.
- This costs nothing and changes nothing until it succeeds — it only ever *creates* the instance you
  already intended to make by hand.

---

## Appendix: running the grabber on **Windows** (bootstrap with no other always-on box)

Use this when you have no GCP/Linux host and want to win an A1 directly from your PC. You only need to
catch it **once** — after that the A1 is your 24/7 host. Leave the script running and stop the PC from
sleeping; the more hours it polls (especially overnight), the better the odds.

**1. Install the OCI CLI (you already have Python 3):**
```powershell
pip install oci-cli
oci --version          # if "not recognized", add your Python Scripts dir to PATH, e.g. C:\Python314\Scripts
```

**2. Authenticate it:**
```powershell
oci setup config
```
Answer the prompts (same as the Linux section above): **User OCID**, **Tenancy OCID** (= your
`COMPARTMENT_OCID`), **Region** (e.g. `ap-singapore-1`), and **Y** to generate an API key. Then upload
the public key to **Console → My profile → API keys → Add API key**:
```powershell
Get-Content $HOME\.oci\oci_api_key_public.pem      # paste this into the console
oci iam region list --output table                 # test — should list regions, not an auth error
```

**3. Make the SSH key the A1 will use:**
```powershell
ssh-keygen -t ed25519 -f $HOME\.ssh\oracle_a1 -N '""'
```
Keep the private key (`$HOME\.ssh\oracle_a1`) — you'll use it to SSH into the A1 once it exists.

**4. Discover the OCIDs** (run the `oci iam ... `, `oci network subnet list`, `oci compute image list`
commands from step 4 above — they work identically in PowerShell).

**5. Fill the env file:**
```powershell
cd $HOME\Documents\lifeOS
Copy-Item deploy\oracle-a1.env.example deploy\oracle-a1.env
notepad deploy\oracle-a1.env
#   set the 4 OCIDs/AD + SSH_PUBKEY_PATH = C:\Users\<you>\.ssh\oracle_a1.pub  (use forward slashes or \\)
```

**6. Stop the PC from sleeping, then run it:**
```powershell
powercfg /change standby-timeout-ac 0      # never sleep on AC power (so it polls overnight)
powercfg /change hibernate-timeout-ac 0
powershell -ExecutionPolicy Bypass -File deploy\oracle-a1-retry.ps1
```
Leave that window open. When you see **SUCCESS**, a `deploy\a1-success.json` appears — go to
**Console → Compute → Instances**, copy the new box's public IP, and SSH in with:
```powershell
ssh -i $HOME\.ssh\oracle_a1 ubuntu@<A1_PUBLIC_IP>
```
Then run the normal lifeOS setup on it (`setup.sh`, `claude` login, Tailscale, Syncthing, pm2).

**Optional — auto-start the grabber at every boot** (so it resumes when you power on at 11am without
you having to relaunch it):
```powershell
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$HOME\Documents\lifeOS\deploy\oracle-a1-retry.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName 'lifeos-a1-grabber' -Action $action -Trigger $trigger -Description 'Poll Oracle for a free A1'
# remove later with:  Unregister-ScheduledTask -TaskName 'lifeos-a1-grabber' -Confirm:$false
```
