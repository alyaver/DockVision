FROM dockurr/windows@sha256:0cff9eb0e7aee9953e55bc682852ca4fdca233145a58ae1ec94f0b0c01a2ed30

# Persistent writes to the OVMF variables pflash can prevent this guest from
# reaching Windows. Keep guest-disk writes persistent while making only the
d# per-boot UEFI variable changes ephemeral.
RUN sed -i 's/waitForBoot "$pid" 30 &/waitForBoot "$pid" 300 \&/' /run/entry.sh \
    && grep -F 'waitForBoot "$pid" 300 &' /run/entry.sh \
    && sed -i 's/file=$DEST.vars,if=pflash,unit=1,format=raw/file=$DEST.vars,if=pflash,unit=1,format=raw,snapshot=on/' /run/boot.sh \
    && grep -F 'file=$DEST.vars,if=pflash,unit=1,format=raw,snapshot=on' /run/boot.sh
