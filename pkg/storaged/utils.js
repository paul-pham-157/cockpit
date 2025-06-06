/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";

import * as service from "service";
import * as timeformat from "timeformat";

const _ = cockpit.gettext;
const C_ = cockpit.gettext;

export const BTRFS_TOOL_MOUNT_PATH = "/run/cockpit/btrfs/";

/* UTILITIES
 */

export function compare_versions(a, b) {
    function to_ints(str) {
        return str.split(".").map(function (s) { return s ? parseInt(s, 10) : 0 });
    }

    const a_ints = to_ints(a);
    const b_ints = to_ints(b);
    const len = Math.min(a_ints.length, b_ints.length);
    let i;

    for (i = 0; i < len; i++) {
        if (a_ints[i] == b_ints[i])
            continue;
        return a_ints[i] - b_ints[i];
    }

    return a_ints.length - b_ints.length;
}

export function parse_options(options) {
    if (options)
        return (options.split(",")
                .map(function (s) { return s.trim() })
                .filter(function (s) { return s != "" }));
    else
        return [];
}

export function unparse_options(split) {
    return split.join(",");
}

export function extract_option(split, opt) {
    const index = split.indexOf(opt);
    if (index >= 0) {
        split.splice(index, 1);
        return true;
    } else {
        return false;
    }
}

export function edit_crypto_config(block, modify) {
    let old_config;
    let new_config;

    function commit() {
        new_config[1]["track-parents"] = { t: 'b', v: true };
        if (old_config)
            return block.UpdateConfigurationItem(old_config, new_config, { });
        else
            return block.AddConfigurationItem(new_config, { });
    }

    return block.GetSecretConfiguration({}).then(
        function (items) {
            old_config = items.find(c => c[0] == "crypttab");
            new_config = ["crypttab", old_config ? Object.assign({ }, old_config[1]) : { }];

            // UDisks insists on always having a "passphrase-contents" field when
            // adding a crypttab entry, but doesn't include one itself when returning
            // an entry without a stored passphrase.
            //
            if (!new_config[1]['passphrase-contents'])
                new_config[1]['passphrase-contents'] = { t: 'ay', v: encode_filename("") };

            return modify(new_config[1], commit);
        });
}

export function set_crypto_options(block, readonly, auto, nofail, netdev) {
    return edit_crypto_config(block, (config, commit) => {
        const opts = config.options ? parse_options(decode_filename(config.options.v)) : [];
        if (readonly !== null) {
            extract_option(opts, "readonly");
            extract_option(opts, "read-only");
            if (readonly)
                opts.push("readonly");
        }
        if (auto !== null) {
            extract_option(opts, "noauto");
            if (!auto)
                opts.push("noauto");
        }
        if (nofail !== null) {
            extract_option(opts, "nofail");
            if (nofail)
                opts.push("nofail");
        }
        if (netdev !== null) {
            extract_option(opts, "_netdev");
            if (netdev)
                opts.push("_netdev");
        }
        config.options = { t: 'ay', v: encode_filename(unparse_options(opts)) };
        return commit();
    });
}

export function set_crypto_auto_option(block, flag) {
    return set_crypto_options(block, null, flag, null, null);
}

export let hostnamed = cockpit.dbus("org.freedesktop.hostname1").proxy();

// for unit tests
let orig_hostnamed;

export function mock_hostnamed(value) {
    if (value) {
        orig_hostnamed = hostnamed;
        hostnamed = value;
    } else {
        hostnamed = orig_hostnamed;
    }
}

export function flatten(array_of_arrays) {
    if (array_of_arrays.length > 0)
        return Array.prototype.concat.apply([], array_of_arrays);
    else
        return [];
}

export const decode_filename = encoded => window.atob(encoded).replace('\u0000', '');
export const encode_filename = decoded => window.btoa(decoded + '\u0000');

export function get_block_mntopts(config) {
    // treat an absent field as "default", like util-linux
    return (config.opts ? decode_filename(config.opts.v) : "defaults");
}

export function fmt_size(bytes) {
    return cockpit.format_bytes(bytes);
}

export function fmt_size_long(bytes) {
    const with_decimal_unit = cockpit.format_bytes(bytes);
    const with_binary_unit = cockpit.format_bytes(bytes, { base2: true });
    /* Translators: Used in "..." */
    return with_decimal_unit + ", " + with_binary_unit + ", " + bytes + " " + C_("format-bytes", "bytes");
}

export function fmt_rate(bytes_per_sec) {
    return cockpit.format_bytes_per_sec(bytes_per_sec);
}

export function format_temperature(kelvin) {
    const celsius = kelvin - 273.15;
    const fahrenheit = 9.0 * celsius / 5.0 + 32.0;
    return celsius.toFixed(1) + "° C / " + fahrenheit.toFixed(1) + "° F";
}

export function format_fsys_usage(used, total) {
    let text = "";
    let parts = cockpit.format_bytes(total, { separate: true, precision: 2 });
    text = " / " + parts.join(" ");
    const unit = parts[1];

    // FIXME: passing explicit unit is deprecated, redesign this
    parts = cockpit.format_bytes(used, unit, { separate: true, precision: 2 });
    return parts[0] + text;
}

export function format_delay(d) {
    return timeformat.distanceToNow(new Date().valueOf() + d);
}

export function format_size_and_text(size, text) {
    return fmt_size(size) + " " + text;
}

export function validate_mdraid_name(name) {
    return validate_lvm2_name(name);
}

export function validate_lvm2_name(name) {
    if (name === "")
        return _("Name cannot be empty.");
    if (name.length > 127)
        return _("Name cannot be longer than 127 characters.");
    const m = name.match(/[^a-zA-Z0-9+._-]/);
    if (m) {
        if (m[0].search(/\s+/) === -1)
            return cockpit.format(_("Name cannot contain the character '$0'."), m[0]);
        else
            return cockpit.format(_("Name cannot contain whitespace."), m[0]);
    }
}

export function validate_fsys_label(label, type) {
    const fs_label_max = {
        xfs: 12,
        ext4: 16,
        vfat: 11,
        ntfs: 128,
        btrfs: 256,
    };

    const limit = fs_label_max[type.replace("luks+", "")];
    const bytes = new TextEncoder().encode(label);
    if (limit && bytes.length > limit) {
        // Let's not confuse people with encoding issues unless
        // they use funny characters.
        if (bytes.length == label.length)
            return cockpit.format(_("Name cannot be longer than $0 characters"), limit);
        else
            return cockpit.format(_("Name cannot be longer than $0 bytes"), limit);
    }
}

export function block_name(block) {
    return decode_filename(block.PreferredDevice);
}

export function block_short_name(block) {
    return block_name(block).replace(/^\/dev\//, "");
}

export function mdraid_name(mdraid) {
    if (!mdraid.Name)
        return "";

    const parts = mdraid.Name.split(":");

    if (parts.length != 2)
        return mdraid.Name;

    /* Check the static (from /etc/hostname) and transient (acquired from DHCP server via
     * NetworkManager → hostnamed, may not exist) host name -- if either one matches, we
     * consider the RAID a local one and just show the device name.
     * Otherwise it's a remote one, and include the host in the name.
     *
     * However: if we call hostnamed too early, before the dbus.proxy() promise is
     * fulfilled, it will not be valid yet (hostnamed properties are undefined);
     * it's too inconvenient to make this function asynchronous, so just don't
     * show the host name in this case. */
    if (hostnamed.StaticHostname === undefined || parts[0] == hostnamed.StaticHostname || parts[0] == hostnamed.Hostname)
        return parts[1];
    else
        return cockpit.format(_("$name (from $host)"),
                              {
                                  name: parts[1],
                                  host: parts[0]
                              });
}

export function lvol_name(lvol) {
    let type;
    if (lvol.Type == "pool")
        type = _("Pool for thin logical volumes");
    else if (lvol.ThinPool != "/")
        type = _("Thin logical volume");
    else if (lvol.Origin != "/")
        type = _("Logical volume (snapshot)");
    else
        type = _("Logical volume");
    return cockpit.format('$0 "$1"', type, lvol.Name);
}

export function drive_name(drive) {
    const name_parts = [];
    if (drive.Vendor)
        name_parts.push(drive.Vendor);
    if (drive.Model)
        name_parts.push(drive.Model);

    let name = name_parts.join(" ");
    if (drive.Serial)
        name += " (" + drive.Serial + ")";
    else if (drive.WWN)
        name += " (" + drive.WWN + ")";

    return name;
}

export function get_block_link_parts(client, path) {
    let is_part;
    let is_crypt;
    let is_lvol;

    while (true) {
        if (client.blocks_part[path] && client.blocks_ptable[client.blocks_part[path].Table]) {
            is_part = true;
            path = client.blocks_part[path].Table;
        } else if (client.blocks[path] && client.blocks[client.blocks[path].CryptoBackingDevice]) {
            is_crypt = true;
            path = client.blocks[path].CryptoBackingDevice;
        } else
            break;
    }

    if (client.blocks_lvm2[path] && client.lvols[client.blocks_lvm2[path].LogicalVolume])
        is_lvol = true;

    const block = client.blocks[path];
    if (!block)
        return;

    let location;
    let link;
    if (client.mdraids[block.MDRaid]) {
        location = ["mdraid", client.mdraids[block.MDRaid].UUID];
        link = cockpit.format(_("MDRAID device $0"), mdraid_name(client.mdraids[block.MDRaid]));
    } else if (client.blocks_lvm2[path] &&
               client.lvols[client.blocks_lvm2[path].LogicalVolume] &&
               client.vgroups[client.lvols[client.blocks_lvm2[path].LogicalVolume].VolumeGroup]) {
        const target = client.vgroups[client.lvols[client.blocks_lvm2[path].LogicalVolume].VolumeGroup].Name;
        location = ["vg", target];
        link = cockpit.format(_("LVM2 volume group $0"), target);
    } else {
        const vdo = client.legacy_vdo_overlay.find_by_block(block);
        if (vdo) {
            location = ["vdo", vdo.name];
            link = cockpit.format(_("VDO device $0"), vdo.name);
        } else {
            location = [block_short_name(block)];
            if (client.drives[block.Drive])
                link = drive_name(client.drives[block.Drive]);
            else
                link = block_name(block);
        }
    }

    // Partitions of logical volumes are shown as just logical volumes.
    let format;
    if (is_lvol && is_crypt)
        format = _("Encrypted logical volume of $0");
    else if (is_part && is_crypt)
        format = _("Encrypted partition of $0");
    else if (is_lvol)
        format = _("Logical volume of $0");
    else if (is_part)
        format = _("Partition of $0");
    else if (is_crypt)
        format = _("Encrypted $0");
    else
        format = "$0";

    return {
        location,
        format,
        link
    };
}

export function go_to_block(client, path) {
    const parts = get_block_link_parts(client, path);
    cockpit.location.go(parts.location);
}

export function get_partitions(client, block) {
    const partitions = client.blocks_partitions[block.path];

    function process_level(level, container_start, container_size) {
        let n;
        let last_end = container_start;
        const total_end = container_start + container_size;
        let block;
        let start;
        let size;
        let is_container;
        let is_contained;

        const result = [];

        function append_free_space(start, size) {
            // There is a lot of rounding and aligning going on in
            // the storage stack.  All of udisks2, libblockdev,
            // and libparted seem to contribute their own ideas of
            // where a partition really should start.
            //
            // The start of partitions are aggressively rounded
            // up, sometimes twice, but the end is not aligned in
            // the same way.  This means that a few megabytes of
            // free space will show up between partitions.
            //
            // We hide these small free spaces because they are
            // unexpected and can't be used for anything anyway.
            //
            // "Small" is anything less than 3 MiB, which seems to
            // work okay.  (The worst case is probably creating
            // the first logical partition inside a extended
            // partition with udisks+libblockdev.  It leads to a 2
            // MiB gap.)

            if (size >= 3 * 1024 * 1024) {
                result.push({ type: 'free', start, size });
            }
        }

        for (n = 0; n < partitions.length; n++) {
            block = client.blocks[partitions[n].path];
            start = partitions[n].Offset;
            size = partitions[n].Size;
            is_container = partitions[n].IsContainer;
            is_contained = partitions[n].IsContained;

            if (block === null)
                continue;

            if (level === 0 && is_contained)
                continue;

            if (level == 1 && !is_contained)
                continue;

            if (start < container_start || start + size > container_start + container_size)
                continue;

            append_free_space(last_end, start - last_end);
            if (is_container) {
                result.push({
                    type: 'container',
                    block,
                    size,
                    partitions: process_level(level + 1, start, size)
                });
            } else {
                result.push({ type: 'block', block });
            }
            last_end = start + size;
        }

        append_free_space(last_end, total_end - last_end);

        return result;
    }

    return process_level(0, 0, block.Size);
}

export function is_available_block(client, block, honor_ignore_hint) {
    const block_ptable = client.blocks_ptable[block.path];
    const block_part = client.blocks_part[block.path];
    const block_pvol = client.blocks_pvol[block.path];

    function has_fs_label() {
        if (!block.IdUsage)
            return false;
        // Devices with a LVM2_member label need to actually be
        // associated with a volume group.
        if (block.IdType == 'LVM2_member' && (!block_pvol || !client.vgroups[block_pvol.VolumeGroup]))
            return false;
        return true;
    }

    function is_mpath_member() {
        if (!client.drives[block.Drive])
            return false;
        if (!client.drives_block[block.Drive]) {
            // Broken multipath drive
            return true;
        }
        const members = client.drives_multipath_blocks[block.Drive];
        for (let i = 0; i < members.length; i++) {
            if (members[i] == block)
                return true;
        }
        return false;
    }

    function is_vdo_backing_dev() {
        return !!client.legacy_vdo_overlay.find_by_backing_block(block);
    }

    function is_swap() {
        return !!block && client.blocks_swap[block.path];
    }

    return (!(block.HintIgnore && honor_ignore_hint) &&
            block.Size > 0 &&
            !has_fs_label() &&
            !is_mpath_member() &&
            !is_vdo_backing_dev() &&
            !is_swap() &&
            !block_ptable &&
            !(block_part && block_part.IsContainer) &&
            !should_ignore(client, block.path));
}

export function get_available_spaces(client) {
    function make(path) {
        const block = client.blocks[path];
        const parts = get_block_link_parts(client, path);
        const text = cockpit.format(parts.format, parts.link);
        return { type: 'block', block, size: block.Size, desc: text };
    }

    const spaces = Object.keys(client.blocks).filter(p => is_available_block(client, client.blocks[p], true))
            .sort(make_block_path_cmp(client))
            .map(make);

    function add_free_spaces(block) {
        const parts = get_partitions(client, block);
        let i;
        let p;
        let link_parts;
        let text;
        for (i in parts) {
            p = parts[i];
            if (p.type == 'free') {
                link_parts = get_block_link_parts(client, block.path);
                text = cockpit.format(link_parts.format, link_parts.link);
                spaces.push({
                    type: 'free',
                    block,
                    start: p.start,
                    size: p.size,
                    desc: cockpit.format(_("unpartitioned space on $0"), text)
                });
            }
        }
    }

    for (const p in client.blocks_ptable)
        add_free_spaces(client.blocks[p]);

    return spaces;
}

export function prepare_available_spaces(client, spcs) {
    function prepare(spc) {
        if (spc.type == 'block')
            return Promise.resolve(spc.block.path);
        else if (spc.type == 'free') {
            const block_ptable = client.blocks_ptable[spc.block.path];
            return block_ptable.CreatePartition(spc.start, spc.size, "", "", { });
        }
    }

    return Promise.all(spcs.map(prepare));
}

export function is_snap(client, block) {
    const block_fsys = client.blocks_fsys[block.path];
    return block_fsys && block_fsys.MountPoints.map(decode_filename).some(mp => mp.indexOf("/snap/") == 0 || mp.indexOf("/var/lib/snapd/snap/") == 0);
}

export function get_other_devices(client) {
    return Object.keys(client.blocks).filter(path => {
        const block = client.blocks[path];
        const block_part = client.blocks_part[path];
        const block_lvm2 = client.blocks_lvm2[path];

        return ((!block_part || block_part.Table == "/") &&
                block.Drive == "/" &&
                block.CryptoBackingDevice == "/" &&
                block.MDRaid == "/" &&
                (!block_lvm2 || block_lvm2.LogicalVolume == "/") &&
                !block.HintIgnore &&
                block.Size > 0 &&
                !client.legacy_vdo_overlay.find_by_block(block) &&
                !client.blocks_stratis_fsys[block.path] &&
                !is_snap(client, block) &&
                !should_ignore(client, block.path));
    });
}

/* Comparison function for sorting lists of block devices.

   We sort by major:minor numbers to get the expected order when
   there are more than 10 devices of a kind.  For example, if you
   have 20 loopback devices named loop0 to loop19, sorting them
   alphabetically would put them in the wrong order

       loop0, loop1, loop10, loop11, ..., loop2, ...

   Sorting by major:minor is an easy way to do the right thing.
*/

export function block_cmp(a, b) {
    return a.DeviceNumber - b.DeviceNumber;
}

export function make_block_path_cmp(client) {
    return function(path_a, path_b) {
        return block_cmp(client.blocks[path_a], client.blocks[path_b]);
    };
}

let multipathd_service;

export function get_multipathd_service () {
    if (!multipathd_service)
        multipathd_service = service.proxy("multipathd");
    return multipathd_service;
}

function get_parent(client, path) {
    if (client.blocks_part[path] && client.blocks[client.blocks_part[path].Table])
        return client.blocks_part[path].Table;
    if (client.blocks[path] && client.blocks[client.blocks[path].CryptoBackingDevice])
        return client.blocks[path].CryptoBackingDevice;
    if (client.blocks[path] && client.drives[client.blocks[path].Drive])
        return client.blocks[path].Drive;
    if (client.blocks[path] && client.mdraids[client.blocks[path].MDRaid])
        return client.blocks[path].MDRaid;
    if (client.blocks_lvm2[path] && client.lvols[client.blocks_lvm2[path].LogicalVolume])
        return client.blocks_lvm2[path].LogicalVolume;
    if (client.lvols[path] && client.vgroups[client.lvols[path].VolumeGroup])
        return client.lvols[path].VolumeGroup;
    if (client.blocks_stratis_fsys[path])
        return client.blocks_stratis_fsys[path].Pool;
    if (client.vgroups[path])
        return path;
    if (client.stratis_pools[path])
        return path;
}

function get_direct_parent_blocks(client, path) {
    if (client.blocks[path])
        path = get_parent(client, path);
    if (!path)
        return [];
    if (client.blocks[path])
        return [path];
    if (client.mdraids[path])
        return client.mdraids_members[path].map(function (m) { return m.path });
    if (client.lvols[path])
        path = client.lvols[path].VolumeGroup;
    if (client.vgroups[path])
        return client.vgroups_pvols[path].map(function (pv) { return pv.path });
    if (client.stratis_pools[path])
        return client.stratis_pool_blockdevs[path].map(bd => client.slashdevs_block[bd.Devnode].path);
    return [];
}

export function get_parent_blocks(client, path) {
    const direct_parents = get_direct_parent_blocks(client, path);
    const direct_and_indirect_parents = flatten(direct_parents.map(function (p) {
        return get_parent_blocks(client, p);
    }));
    return [path].concat(direct_and_indirect_parents);
}

export function is_netdev(client, path) {
    const block = client.blocks[path];
    const drive = block && client.drives[block.Drive];
    if (drive && drive.Vendor == "LIO-ORG")
        return true;
    if (block && block.Major == 43) // NBD
        return true;
    return false;
}

export function should_ignore(client, path) {
    const block = client.blocks[path];

    // HACK - https://github.com/stratis-storage/stratisd/issues/3801
    //
    // Filter out Stratis private device mapper devices. This normally
    // happens by setting the DM_UDEV_DISABLE_OTHER_RULES_FLAG in the
    // udev database (which causes UDisks2 to ignore the block
    // device), but since Stratis 3.8 the "*-crypt" devices don't have
    // them.

    if (block && decode_filename(block.PreferredDevice).startsWith("/dev/mapper/stratis-1-private"))
        return true;

    // Check what Anaconda tells us.

    if (!client.in_anaconda_mode())
        return false;

    const parents = get_direct_parent_blocks(client, path);
    if (parents.length == 0) {
        return block && client.should_ignore_block(block);
    } else {
        return parents.some(p => should_ignore(client, p));
    }
}

/* GET_CHILDREN gets the direct children of the storage object at
   PATH, like the partitions of a partitioned block device, or the
   volume group of a physical volume.  By calling GET_CHILDREN
   recursively, you can traverse the whole storage hierarchy from
   hardware drives at the bottom to filesystems at the top.

   GET_CHILDREN_FOR_TEARDOWN is similar but doesn't consider things
   like volume groups to be children of their physical volumes.  This
   is appropriate for teardown processing, where tearing down a
   physical volume does not imply tearing down the whole volume group
   with everything that it contains.
*/

function get_children_for_teardown(client, path) {
    const children = [];

    if (client.blocks_cleartext[path]) {
        children.push(client.blocks_cleartext[path].path);
    }

    if (client.blocks_ptable[path]) {
        client.blocks_partitions[path].forEach(function (part) {
            if (!part.IsContainer)
                children.push(part.path);
        });
    }

    if (client.blocks_part[path] && client.blocks_part[path].IsContainer) {
        const ptable_path = client.blocks_part[path].Table;
        client.blocks_partitions[ptable_path].forEach(function (part) {
            if (part.IsContained)
                children.push(part.path);
        });
    }

    if (client.vgroups[path]) {
        client.vgroups_lvols[path].forEach(function (lvol) {
            if (client.lvols_block[lvol.path])
                children.push(client.lvols_block[lvol.path].path);
        });
    }

    if (client.lvols_pool_members[path]) {
        for (const lvol of client.lvols_pool_members[path]) {
            const block = client.lvols_block[lvol.path];
            if (block)
                children.push(block.path);
        }
    }

    if (client.stratis_pools[path]) {
        client.stratis_pool_filesystems[path].forEach(function (fsys) {
            const block = client.slashdevs_block[fsys.Devnode];
            if (block)
                children.push(block.path);
        });
    }

    return children;
}

export function get_children(client, path) {
    const children = get_children_for_teardown(client, path);

    if (client.blocks[path]) {
        const mdraid = client.blocks[path].MDRaidMember;
        if (mdraid != "/")
            children.push(mdraid);
    }

    if (client.blocks_pvol[path]) {
        const vgroup = client.blocks_pvol[path].VolumeGroup;
        if (vgroup != "/")
            children.push(vgroup);
    }

    if (client.blocks_stratis_blockdev[path]) {
        const pool = client.blocks_stratis_blockdev[path].Pool;
        if (pool != "/")
            children.push(pool);
    }

    return children;
}

export function find_children_for_mount_point(client, mount_point, self) {
    const children = {};

    function is_self(b) {
        return self && (b == self || client.blocks[b.CryptoBackingDevice] == self);
    }

    for (const p in client.blocks) {
        const b = client.blocks[p];
        const fs = client.blocks_fsys[p];

        if (is_self(b))
            continue;

        if (fs) {
            for (const mp of fs.MountPoints) {
                const mpd = decode_filename(mp);
                if (mpd.length > mount_point.length && mpd.indexOf(mount_point) == 0 && mpd[mount_point.length] == "/")
                    children[mpd] = b;
            }
        }
    }

    return children;
}

export function get_fstab_config_with_client(client, block, also_child_config, subvol) {
    function match(c) {
        if (c[0] != "fstab")
            return false;
        if (subvol !== undefined) {
            if (!c[1].opts)
                return false;

            const opts = decode_filename(c[1].opts.v).split(",");
            if (opts.indexOf("subvolid=" + subvol.id) >= 0)
                return true;
            if (opts.indexOf("subvol=" + subvol.pathname) >= 0 || opts.indexOf("subvol=/" + subvol.pathname) >= 0)
                return true;

            // btrfs mounted without subvol argument.
            const btrfs_volume = client.blocks_fsys_btrfs[block.path];
            const default_subvolid = client.uuids_btrfs_default_subvol[btrfs_volume.data.uuid];
            if (default_subvolid === subvol.id && !opts.find(o => o.indexOf("subvol=") >= 0 || o.indexOf("subvolid=") >= 0))
                return true;

            return false;
        }
        return true;
    }

    let config = block.Configuration.find(match);

    if (!config && also_child_config && client.blocks_crypto[block.path])
        config = client.blocks_crypto[block.path]?.ChildConfiguration.find(c => c[0] == "fstab");

    if (config && decode_filename(config[1].type.v) != "swap") {
        const mnt_opts = get_block_mntopts(config[1]).split(",");
        let dir = decode_filename(config[1].dir.v);
        let opts = mnt_opts
                .filter(function (s) { return s.indexOf("x-parent") !== 0 })
                .join(",");
        const parents = mnt_opts
                .filter(function (s) { return s.indexOf("x-parent") === 0 })
                .join(",");
        if (dir[0] != "/")
            dir = "/" + dir;
        if (opts == "defaults")
            opts = "";
        return [config, dir, opts, parents];
    } else
        return [];
}

export function get_active_usage(client, path, top_action, child_action, is_temporary, subvol, allow_multi_device_delete) {
    function get_usage(usage, path, level) {
        const block = client.blocks[path];
        const fsys = client.blocks_fsys[path];
        const swap = client.blocks_swap[path];
        const mdraid = block && client.mdraids[block.MDRaidMember];
        const pvol = client.blocks_pvol[path];
        const vgroup = pvol && client.vgroups[pvol.VolumeGroup];
        const vdo = block && client.legacy_vdo_overlay.find_by_backing_block(block);
        const stratis_blockdev = block && client.blocks_stratis_blockdev[path];
        const stratis_pool = stratis_blockdev && client.stratis_pools[stratis_blockdev.Pool];
        const btrfs_volume = client.blocks_fsys_btrfs[path];

        get_children_for_teardown(client, path).map(p => get_usage(usage, p, level + 1));

        function get_actions(teardown_action) {
            const actions = [];
            if (teardown_action)
                actions.push(teardown_action);
            const global_action = (level == 0 || (block && client.blocks[block.CryptoBackingDevice] && level == 1)) ? top_action : child_action || top_action;
            if (global_action)
                actions.push(global_action);
            return actions;
        }

        function enter_unmount(block, location, is_top) {
            const [, mount_point] = get_fstab_config_with_client(client, block);
            const has_fstab_entry = is_temporary && location == mount_point;

            // Ignore the secret btrfs mount point unless we are
            // formatting (in which case subvol is false).
            if (btrfs_volume && subvol && location.startsWith(BTRFS_TOOL_MOUNT_PATH))
                return;

            for (const u of usage) {
                if (u.usage == 'mounted' && u.location == location) {
                    if (is_top) {
                        u.actions = get_actions(_("unmount"));
                        u.set_noauto = false;
                    }
                    return;
                }
            }
            usage.push({
                level,
                block,
                usage: 'mounted',
                location,
                has_fstab_entry,
                set_noauto: !is_top && !is_temporary,
                actions: (is_top ? get_actions(_("unmount")) : [_("unmount")]).concat(has_fstab_entry ? [_("mount")] : []),
                blocking: client.strip_mount_point_prefix(location) === false && !location.startsWith(BTRFS_TOOL_MOUNT_PATH),
            });
        }

        // HACK: get_active_usage is used for mounting and formatting so we use the absence of the subvol argument
        // to figure out that we want to format this device.
        // This is separate from the if's below as we also always have to umount the filesystem.

        // We allow a btrfs volume with one device to be formatted as this
        // looks the most like a normal filesystem use case.
        if (btrfs_volume && btrfs_volume.data.num_devices !== 1 && !subvol && !allow_multi_device_delete) {
            usage.push({
                level,
                usage: 'btrfs-device',
                block,
                btrfs_volume,
                location: btrfs_volume.data.label || btrfs_volume.data.uuid,
                actions: get_actions(_("remove from btrfs volume")),
                blocking: true,
            });
        }

        const mount_points = get_mount_points(client, fsys, subvol);
        if (mount_points.length > 0) {
            mount_points.forEach(mp => {
                const children = find_children_for_mount_point(client, mp, null);
                for (const c in children)
                    enter_unmount(children[c], c, false);
                enter_unmount(block, mp, true);
            });
        } else if (swap) {
            if (swap.Active) {
                usage.push({
                    level,
                    usage: 'swap',
                    block,
                    actions: get_actions(_("stop")),
                });
            }
        } else if (mdraid) {
            const active_state = mdraid.ActiveDevices.find(as => as[0] == block.path);
            usage.push({
                level,
                usage: 'mdraid-member',
                block,
                mdraid,
                location: mdraid_name(mdraid),
                actions: get_actions(_("remove from MDRAID")),
                blocking: !(active_state && active_state[1] < 0)
            });
        } else if (vgroup) {
            usage.push({
                level,
                usage: 'pvol',
                block,
                vgroup,
                pvol,
                location: vgroup.Name,
                actions: get_actions(_("remove from LVM2")),
                blocking: pvol.FreeSize != pvol.Size
            });
        } else if (vdo) {
            usage.push({
                level,
                usage: 'vdo-backing',
                block,
                vdo,
                location: vdo.name,
                blocking: true
            });
        } else if (stratis_pool) {
            usage.push({
                level,
                usage: 'stratis-pool-member',
                block,
                stratis_pool,
                location: stratis_pool.Name,
                blocking: true
            });
        } else if (block && !client.blocks_cleartext[block.path]) {
            usage.push({
                level,
                usage: 'none',
                block,
                actions: get_actions(null),
                blocking: false
            });
        }

        return usage;
    }

    const usage = [];
    get_usage(usage, path, 0);

    usage.Blocking = usage.some(u => u.blocking);
    usage.Teardown = usage.some(u => !u.blocking);

    if (usage.length == 1 && usage[0].level == 0 && usage[0].usage == "none")
        usage.Teardown = false;

    return usage;
}

async function set_fsys_noauto(client, block, mount_point) {
    for (const conf of block.Configuration) {
        if (conf[0] == "fstab" &&
            decode_filename(conf[1].dir.v) == mount_point) {
            const options = parse_options(get_block_mntopts(conf[1]));
            if (options.indexOf("noauto") >= 0)
                continue;
            options.push("noauto");
            const new_conf = [
                "fstab",
                Object.assign({ }, conf[1],
                              {
                                  opts: {
                                      t: 'ay',
                                      v: encode_filename(unparse_options(options))
                                  }
                              })
            ];
            await block.UpdateConfigurationItem(conf, new_conf, { });
        }
    }

    const crypto_backing = client.blocks[block.CryptoBackingDevice];
    if (crypto_backing) {
        const crypto_backing_crypto = client.blocks_crypto[crypto_backing.path];
        await set_crypto_auto_option(crypto_backing, false);
        if (crypto_backing_crypto)
            await crypto_backing_crypto.Lock({});
    }
}

export function teardown_active_usage(client, usage) {
    // The code below is complicated by the fact that the last
    // physical volume of a volume group can not be removed
    // directly (even if it is completely empty).  We want to
    // remove the whole volume group instead in this case.
    //
    // However, we might be removing the last two (or more)
    // physical volumes here, and it is easiest to catch this
    // condition upfront by reshuffling the data structures.

    async function unmount(mounteds) {
        for (const m of mounteds) {
            await client.unmount_at(m.location, m.users);
            if (m.set_noauto)
                await set_fsys_noauto(client, m.block, m.location);
        }
    }

    async function stop_swap(swaps) {
        for (const s of swaps) {
            await client.blocks_swap[s.block.path].Stop({});
        }
    }

    function mdraid_remove(members) {
        return Promise.all(members.map(m => m.mdraid.RemoveDevice(m.block.path, { wipe: { t: 'b', v: true } })));
    }

    function pvol_remove(pvols) {
        const by_vgroup = { };
        pvols.forEach(function (p) {
            if (!by_vgroup[p.vgroup.path])
                by_vgroup[p.vgroup.path] = [];
            by_vgroup[p.vgroup.path].push(p.block);
        });

        function handle_vg(p) {
            const vg = client.vgroups[p];
            const pvs = by_vgroup[p];
            // If we would remove all physical volumes of a volume
            // group, remove the whole volume group instead.
            if (pvs.length == client.vgroups_pvols[p].length) {
                return vg.Delete(true, { 'tear-down': { t: 'b', v: true } }).then(reload_systemd);
            } else {
                return Promise.all(pvs.map(pv => vg.RemoveDevice(pv.path, true, {})));
            }
        }

        return Promise.all(Object.keys(by_vgroup).map(handle_vg));
    }

    return Promise.all(Array.prototype.concat(
        unmount(usage.filter(function(use) { return use.usage == "mounted" })),
        stop_swap(usage.filter(function(use) { return use.usage == "swap" })),
        mdraid_remove(usage.filter(function(use) { return use.usage == "mdraid-member" })),
        pvol_remove(usage.filter(function(use) { return use.usage == "pvol" }))
    ));
}

export async function undo_temporary_teardown(client, usage) {
    for (let i = usage.length - 1; i >= 0; i--) {
        const u = usage[i];
        if (u.usage == "mounted" && u.has_fstab_entry) {
            await client.mount_at(u.block, u.location);
        }
    }
}

// TODO - generalize this to arbitrary number of arguments (when needed)
export function fmt_to_array(fmt, arg) {
    const index = fmt.indexOf("$0");
    if (index >= 0)
        return [fmt.slice(0, index), arg, fmt.slice(index + 2)];
    else
        return [fmt];
}

export function reload_systemd() {
    return cockpit.spawn(["systemctl", "daemon-reload"], { superuser: "require", err: "message" });
}

export function is_mounted_synch(block) {
    return (cockpit.spawn(["findmnt", "-n", "-o", "TARGET", "-S", decode_filename(block.Device)],
                          { superuser: "require", err: "message" })
            .then(data => data.trim())
            .catch(() => false));
}

export function for_each_async(arr, func) {
    return arr.reduce((promise, elt) => promise.then(() => func(elt)), Promise.resolve());
}

/*
 * Get mount points for a given org.freedesktop.UDisks2.Filesystem object
 *
 * This generalises getting the given MountPoints of a Filesystem for btrfs and
 * other filesystems, for btrfs we want to know if a subvolume is mounted
 * anywhere. UDisks is currently not aware of subvolumes and it's Filesystem
 * object gives us the MountPoints for all subvolumes while we want it per
 * subvolume.
 *
 * @param {Object} block_fsys
 * @param {Object|null} subvol
 * @returns {Array} an array of MountPoints
 */
export function get_mount_points(client, block_fsys, subvol) {
    let mounted_at = [];

    if (subvol && block_fsys) {
        const btrfs_volume = client.blocks_fsys_btrfs[block_fsys.path];
        const volume_mounts = client.btrfs_mounts[btrfs_volume.data.uuid];
        if (volume_mounts)
            mounted_at = subvol.id in volume_mounts ? volume_mounts[subvol.id].mount_points : [];
    } else {
        mounted_at = block_fsys ? block_fsys.MountPoints.map(decode_filename) : [];
    }

    return mounted_at;
}

export function get_byte_units(guide_value) {
    const units = [
        { factor: 1000 ** 2, name: "MB" },
        { factor: 1000 ** 3, name: "GB" },
        { factor: 1000 ** 4, name: "TB" },
    ];
    // Find the biggest unit which gives two digits left of the decimal point (>= 10)
    let unit;
    for (unit = units.length - 1; unit >= 0; unit--)
        if (guide_value / units[unit].factor >= 10)
            break;
    // Mark it selected.  If we couldn't find one (-1), then use MB.
    units[Math.max(0, unit)].selected = true;
    return units;
}

/** @type (client: any, path: string) => boolean */
export function contains_rootfs(client, path) {
    const block = client.blocks[path];
    const crypto = client.blocks_crypto[path];
    let fsys_config = null;

    if (block)
        fsys_config = block.Configuration.find(c => c[0] == "fstab");
    if (!fsys_config && crypto)
        fsys_config = crypto.ChildConfiguration.find(c => c[0] == "fstab");

    if (fsys_config) {
        const dir = decode_filename(fsys_config[1].dir.v);
        return dir == "/";
    }

    return get_children(client, path).some(p => contains_rootfs(client, p));
}
