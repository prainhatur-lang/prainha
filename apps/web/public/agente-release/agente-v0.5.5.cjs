/* concilia agente local - bundle gerado por esbuild */
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb2, mod) => function __require() {
  return mod || (0, cb2[__getOwnPropNames(cb2)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/const.js
var require_const = __commonJS({
  "../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/const.js"(exports2, module2) {
    var defaultOptions = {
      DEFAULT_HOST: "127.0.0.1",
      DEFAULT_PORT: 3050,
      DEFAULT_USER: "SYSDBA",
      DEFAULT_PASSWORD: "masterkey",
      DEFAULT_LOWERCASE_KEYS: false,
      DEFAULT_PAGE_SIZE: 4096,
      DEFAULT_SVC_NAME: "service_mgr",
      DEFAULT_ENCODING: "UTF8",
      DEFAULT_FETCHSIZE: 200
    };
    var buffer = {
      MAX_BUFFER_SIZE: 8192
    };
    var int = {
      MAX_INT: Math.pow(2, 31) - 1,
      MIN_INT: -Math.pow(2, 31)
    };
    var op = {
      op_void: 0,
      // Packet has been voided
      op_connect: 1,
      // Connect to remote server
      op_exit: 2,
      // Remote end has exitted
      op_accept: 3,
      // Server accepts connection
      op_reject: 4,
      // Server rejects connection
      op_disconnect: 6,
      // Connect is going away
      op_response: 9,
      // Generic response block
      // Full context server operations
      op_attach: 19,
      // Attach database
      op_create: 20,
      // Create database
      op_detach: 21,
      // Detach database
      op_compile: 22,
      // Request based operations
      op_start: 23,
      op_start_and_send: 24,
      op_send: 25,
      op_receive: 26,
      op_unwind: 27,
      // apparently unused, see protocol.cpp's case op_unwind
      op_release: 28,
      op_transaction: 29,
      // Transaction operations
      op_commit: 30,
      op_rollback: 31,
      op_prepare: 32,
      op_reconnect: 33,
      op_create_blob: 34,
      // Blob operations
      op_open_blob: 35,
      op_get_segment: 36,
      op_put_segment: 37,
      op_cancel_blob: 38,
      op_close_blob: 39,
      op_info_database: 40,
      // Information services
      op_info_request: 41,
      op_info_transaction: 42,
      op_info_blob: 43,
      op_batch_segments: 44,
      // Put a bunch of blob segments
      op_que_events: 48,
      // Que event notification request
      op_cancel_events: 49,
      // Cancel event notification request
      op_commit_retaining: 50,
      // Commit retaining (what else)
      op_prepare2: 51,
      // Message form of prepare
      op_event: 52,
      // Completed event request (asynchronous)
      op_connect_request: 53,
      // Request to establish connection
      op_aux_connect: 54,
      // Establish auxiliary connection
      op_ddl: 55,
      // DDL call
      op_open_blob2: 56,
      op_create_blob2: 57,
      op_get_slice: 58,
      op_put_slice: 59,
      op_slice: 60,
      // Successful response to op_get_slice
      op_seek_blob: 61,
      // Blob seek operation
      // DSQL operations
      op_allocate_statement: 62,
      // allocate a statment handle
      op_execute: 63,
      // execute a prepared statement
      op_exec_immediate: 64,
      // execute a statement
      op_fetch: 65,
      // fetch a record
      op_fetch_response: 66,
      // response for record fetch
      op_free_statement: 67,
      // free a statement
      op_prepare_statement: 68,
      // prepare a statement
      op_set_cursor: 69,
      // set a cursor name
      op_info_sql: 70,
      op_dummy: 71,
      // dummy packet to detect loss of client
      op_response_piggyback: 72,
      // response block for piggybacked messages
      op_start_and_receive: 73,
      op_start_send_and_receive: 74,
      op_exec_immediate2: 75,
      // execute an immediate statement with msgs
      op_execute2: 76,
      // execute a statement with msgs
      op_insert: 77,
      op_sql_response: 78,
      // response from execute, exec immed, insert
      op_transact: 79,
      op_transact_response: 80,
      op_drop_database: 81,
      op_service_attach: 82,
      op_service_detach: 83,
      op_service_info: 84,
      op_service_start: 85,
      op_rollback_retaining: 86,
      op_partial: 89,
      // packet is not complete - delay processing
      op_trusted_auth: 90,
      op_cancel: 91,
      op_cont_auth: 92,
      op_ping: 93,
      op_accept_data: 94,
      // Server accepts connection and returns some data to client
      op_abort_aux_connection: 95,
      // Async operation - stop waiting for async connection to arrive
      op_crypt: 96,
      op_crypt_key_callback: 97,
      op_cond_accept: 98
      // Server accepts connection, returns some data to client
      // and asks client to continue authentication before attach call
    };
    var dsql = {
      DSQL_close: 1,
      DSQL_drop: 2,
      DSQL_unprepare: 4
      // >: 2.5
    };
    var iscError = {
      isc_sqlerr: 335544436,
      isc_arg_end: 0,
      // end of argument list
      isc_arg_gds: 1,
      // generic DSRI status value
      isc_arg_string: 2,
      // string argument
      isc_arg_cstring: 3,
      // count & string argument
      isc_arg_number: 4,
      // numeric argument (long)
      isc_arg_interpreted: 5,
      // interpreted status code (string)
      isc_arg_unix: 7,
      // UNIX error code
      isc_arg_next_mach: 15,
      // NeXT/Mach error code
      isc_arg_win32: 17,
      // Win32 error code
      isc_arg_warning: 18,
      // warning argument
      isc_arg_sql_state: 19
      // SQLSTATE
    };
    var connect = {
      CONNECT_VERSION2: 2,
      CONNECT_VERSION3: 3,
      ARCHITECTURE_GENERIC: 1
    };
    var FB_PROTOCOL_FLAG = 32768;
    var protocol = {
      // Protocol 10 includes support for warnings and removes the requirement for
      // encoding and decoding status codes
      PROTOCOL_VERSION10: 10,
      // Since protocol 11 we must be separated from Borland Interbase.
      // Therefore always set highmost bit in protocol version to 1.
      // For unsigned protocol version this does not break version's compare.
      FB_PROTOCOL_FLAG,
      FB_PROTOCOL_MASK: ~FB_PROTOCOL_FLAG & 65535,
      // Protocol 11 has support for user authentication related
      // operations (op_update_account_info, op_authenticate_user and
      // op_trusted_auth). When specific operation is not supported,
      // we say "sorry".
      PROTOCOL_VERSION11: FB_PROTOCOL_FLAG | 11,
      // Protocol 12 has support for asynchronous call op_cancel.
      // Currently implemented asynchronously only for TCP/IP.
      PROTOCOL_VERSION12: FB_PROTOCOL_FLAG | 12,
      // Protocol 13 has support for authentication plugins (op_cont_auth).
      PROTOCOL_VERSION13: FB_PROTOCOL_FLAG | 13,
      // Protocol 14 has support for wire encryption.
      PROTOCOL_VERSION14: FB_PROTOCOL_FLAG | 14,
      // Protocol 15 has support for conditional accept with early wire encryption.
      PROTOCOL_VERSION15: FB_PROTOCOL_FLAG | 15
    };
    var acceptType = {
      ptype_rpc: 2,
      // Simple remote procedure call
      ptype_batch_send: 3,
      // Batch sends, no asynchrony
      ptype_out_of_band: 4,
      // Batch sends w/ out of band notification
      ptype_lazy_send: 5,
      // Deferred packets delivery;
      ptype_mask: 255,
      // Mask - up to 255 types of protocol
      pflag_compress: 256
      // Turn on compression if possible
    };
    var SUPPORTED_PROTOCOL = [
      [protocol.PROTOCOL_VERSION10, connect.ARCHITECTURE_GENERIC, acceptType.ptype_rpc, acceptType.ptype_batch_send, 1],
      [protocol.PROTOCOL_VERSION11, connect.ARCHITECTURE_GENERIC, acceptType.ptype_lazy_send, acceptType.ptype_lazy_send, 2],
      [protocol.PROTOCOL_VERSION12, connect.ARCHITECTURE_GENERIC, acceptType.ptype_lazy_send, acceptType.ptype_lazy_send, 3],
      [protocol.PROTOCOL_VERSION13, connect.ARCHITECTURE_GENERIC, acceptType.ptype_lazy_send, acceptType.ptype_lazy_send, 4],
      [protocol.PROTOCOL_VERSION14, connect.ARCHITECTURE_GENERIC, acceptType.ptype_lazy_send, acceptType.ptype_lazy_send, 5],
      [protocol.PROTOCOL_VERSION15, connect.ARCHITECTURE_GENERIC, acceptType.ptype_lazy_send, acceptType.ptype_lazy_send, 6]
    ];
    var authPlugin = {
      AUTH_PLUGIN_LEGACY: "Legacy_Auth",
      AUTH_PLUGIN_SRP: "Srp",
      AUTH_PLUGIN_SRP256: "Srp256"
    };
    var authOptions = {
      AUTH_PLUGIN_LIST: [authPlugin.AUTH_PLUGIN_SRP256, authPlugin.AUTH_PLUGIN_SRP, authPlugin.AUTH_PLUGIN_LEGACY],
      AUTH_PLUGIN_SRP_LIST: [authPlugin.AUTH_PLUGIN_SRP256, authPlugin.AUTH_PLUGIN_SRP],
      LEGACY_AUTH_SALT: "9z",
      WIRE_CRYPT_DISABLE: 0,
      WIRE_CRYPT_ENABLE: 1
    };
    var sqlType = {
      SQL_TEXT: 452,
      // Array of char
      SQL_VARYING: 448,
      SQL_SHORT: 500,
      SQL_LONG: 496,
      SQL_FLOAT: 482,
      SQL_DOUBLE: 480,
      SQL_D_FLOAT: 530,
      SQL_TIMESTAMP: 510,
      SQL_BLOB: 520,
      SQL_ARRAY: 540,
      SQL_QUAD: 550,
      SQL_TYPE_TIME: 560,
      SQL_TYPE_DATE: 570,
      SQL_INT64: 580,
      SQL_INT128: 32752,
      // >= 4.0
      SQL_BOOLEAN: 32764,
      // >: 3.0
      SQL_NULL: 32766
      // >= 2.5
    };
    var blobType = {
      isc_blob_text: 1
    };
    var blr = {
      blr_text: 14,
      blr_text2: 15,
      blr_short: 7,
      blr_long: 8,
      blr_quad: 9,
      blr_float: 10,
      blr_double: 27,
      blr_d_float: 11,
      blr_timestamp: 35,
      blr_varying: 37,
      blr_varying2: 38,
      blr_blob: 261,
      blr_cstring: 40,
      blr_cstring2: 41,
      blr_blob_id: 45,
      blr_sql_date: 12,
      blr_sql_time: 13,
      blr_int64: 16,
      blr_int128: 26,
      // >: 4.0
      blr_blob2: 17,
      // >: 2.0
      blr_domain_name: 18,
      // >: 2.1
      blr_domain_name2: 19,
      // >: 2.1
      blr_not_nullable: 20,
      // >: 2.1
      blr_column_name: 21,
      // >: 2.5
      blr_column_name2: 22,
      // >: 2.5
      blr_bool: 23,
      // >: 3.0
      blr_version4: 4,
      blr_version5: 5,
      // dialect 3
      blr_eoc: 76,
      blr_end: 255,
      blr_assignment: 1,
      blr_begin: 2,
      blr_dcl_variable: 3,
      blr_message: 4
    };
    var dpb = {
      isc_dpb_version1: 1,
      isc_dpb_version2: 2,
      // >: FB30
      isc_dpb_cdd_pathname: 1,
      isc_dpb_allocation: 2,
      isc_dpb_journal: 3,
      isc_dpb_page_size: 4,
      isc_dpb_num_buffers: 5,
      isc_dpb_buffer_length: 6,
      isc_dpb_debug: 7,
      isc_dpb_garbage_collect: 8,
      isc_dpb_verify: 9,
      isc_dpb_sweep: 10,
      isc_dpb_enable_journal: 11,
      isc_dpb_disable_journal: 12,
      isc_dpb_dbkey_scope: 13,
      isc_dpb_number_of_users: 14,
      isc_dpb_trace: 15,
      isc_dpb_no_garbage_collect: 16,
      isc_dpb_damaged: 17,
      isc_dpb_license: 18,
      isc_dpb_sys_user_name: 19,
      isc_dpb_encrypt_key: 20,
      isc_dpb_activate_shadow: 21,
      isc_dpb_sweep_interval: 22,
      isc_dpb_delete_shadow: 23,
      isc_dpb_force_write: 24,
      isc_dpb_begin_log: 25,
      isc_dpb_quit_log: 26,
      isc_dpb_no_reserve: 27,
      isc_dpb_user_name: 28,
      isc_dpb_password: 29,
      isc_dpb_password_enc: 30,
      isc_dpb_sys_user_name_enc: 31,
      isc_dpb_interp: 32,
      isc_dpb_online_dump: 33,
      isc_dpb_old_file_size: 34,
      isc_dpb_old_num_files: 35,
      isc_dpb_old_file: 36,
      isc_dpb_old_start_page: 37,
      isc_dpb_old_start_seqno: 38,
      isc_dpb_old_start_file: 39,
      isc_dpb_old_dump_id: 41,
      isc_dpb_lc_messages: 47,
      isc_dpb_lc_ctype: 48,
      isc_dpb_cache_manager: 49,
      isc_dpb_shutdown: 50,
      isc_dpb_online: 51,
      isc_dpb_shutdown_delay: 52,
      isc_dpb_reserved: 53,
      isc_dpb_overwrite: 54,
      isc_dpb_sec_attach: 55,
      isc_dpb_connect_timeout: 57,
      isc_dpb_dummy_packet_interval: 58,
      isc_dpb_gbak_attach: 59,
      isc_dpb_sql_role_name: 60,
      isc_dpb_set_page_buffers: 61,
      isc_dpb_working_directory: 62,
      isc_dpb_sql_dialect: 63,
      isc_dpb_set_db_readonly: 64,
      isc_dpb_set_db_sql_dialect: 65,
      isc_dpb_gfix_attach: 66,
      isc_dpb_gstat_attach: 67,
      isc_dpb_set_db_charset: 68,
      isc_dpb_gsec_attach: 69,
      isc_dpb_address_path: 70,
      isc_dpb_process_id: 71,
      isc_dpb_no_db_triggers: 72,
      isc_dpb_trusted_auth: 73,
      isc_dpb_process_name: 74,
      isc_dpb_trusted_role: 75,
      isc_dpb_org_filename: 76,
      isc_dpb_utf8_filename: 77,
      isc_dpb_ext_call_depth: 78,
      isc_dpb_auth_block: 79,
      isc_dpb_client_version: 80,
      isc_dpb_remote_protocol: 81,
      isc_dpb_host_name: 82,
      isc_dpb_os_user: 83,
      isc_dpb_specific_auth_data: 84,
      isc_dpb_auth_plugin_list: 85,
      isc_dpb_auth_plugin_name: 86,
      isc_dpb_config: 87,
      isc_dpb_nolinger: 88,
      isc_dpb_reset_icu: 89,
      isc_dpb_map_attach: 90,
      isc_dpb_session_time_zone: 91
    };
    var cnct = {
      CNCT_user: 1,
      // User name
      CNCT_passwd: 2,
      // CNCT_ppo : 3, // Apollo person, project, organization. OBSOLETE.
      CNCT_host: 4,
      CNCT_group: 5,
      // Effective Unix group id
      CNCT_user_verification: 6,
      // Attach/create using this connection will use user verification
      CNCT_specific_data: 7,
      // Some data, needed for user verification on server
      CNCT_plugin_name: 8,
      // Name of plugin, which generated that data
      CNCT_login: 9,
      // Same data as isc_dpb_user_name
      CNCT_plugin_list: 10,
      // List of plugins, available on client
      CNCT_client_crypt: 11,
      // Client encyption level (DISABLED/ENABLED/REQUIRED)
      WIRE_CRYPT_DISABLED: 0,
      WIRE_CRYPT_ENABLED: 1,
      WIRE_CRYPT_REQUIRED: 2
    };
    var common = {
      isc_info_end: 1,
      isc_info_truncated: 2,
      isc_info_error: 3,
      isc_info_data_not_ready: 4,
      isc_info_length: 126,
      isc_info_flag_end: 127
    };
    var tpb = {
      isc_tpb_version1: 1,
      isc_tpb_version3: 3,
      isc_tpb_consistency: 1,
      isc_tpb_concurrency: 2,
      isc_tpb_shared: 3,
      // < FB21
      isc_tpb_protected: 4,
      // < FB21
      isc_tpb_exclusive: 5,
      // < FB21
      isc_tpb_wait: 6,
      isc_tpb_nowait: 7,
      isc_tpb_read: 8,
      isc_tpb_write: 9,
      isc_tpb_lock_read: 10,
      isc_tpb_lock_write: 11,
      isc_tpb_verb_time: 12,
      isc_tpb_commit_time: 13,
      isc_tpb_ignore_limbo: 14,
      isc_tpb_read_committed: 15,
      isc_tpb_autocommit: 16,
      isc_tpb_rec_version: 17,
      isc_tpb_no_rec_version: 18,
      isc_tpb_restart_requests: 19,
      isc_tpb_no_auto_undo: 20,
      isc_tpb_lock_timeout: 21
      // >= FB20
    };
    var transactionIsolation = {
      ISOLATION_READ_UNCOMMITTED: [tpb.isc_tpb_read_committed, tpb.isc_tpb_rec_version],
      ISOLATION_READ_COMMITTED: [tpb.isc_tpb_read_committed, tpb.isc_tpb_no_rec_version],
      ISOLATION_REPEATABLE_READ: [tpb.isc_tpb_concurrency],
      ISOLATION_SERIALIZABLE: [tpb.isc_tpb_consistency],
      ISOLATION_READ_COMMITTED_READ_ONLY: [tpb.isc_tpb_read_committed, tpb.isc_tpb_no_rec_version]
    };
    var sqlInfo = {
      isc_info_sql_select: 4,
      isc_info_sql_bind: 5,
      isc_info_sql_num_variables: 6,
      isc_info_sql_describe_vars: 7,
      isc_info_sql_describe_end: 8,
      isc_info_sql_sqlda_seq: 9,
      isc_info_sql_message_seq: 10,
      isc_info_sql_type: 11,
      isc_info_sql_sub_type: 12,
      isc_info_sql_scale: 13,
      isc_info_sql_length: 14,
      isc_info_sql_null_ind: 15,
      isc_info_sql_field: 16,
      isc_info_sql_relation: 17,
      isc_info_sql_owner: 18,
      isc_info_sql_alias: 19,
      isc_info_sql_sqlda_start: 20,
      isc_info_sql_stmt_type: 21,
      isc_info_sql_get_plan: 22,
      isc_info_sql_records: 23,
      isc_info_sql_batch_fetch: 24,
      isc_info_sql_relation_alias: 25,
      // >: 2.0
      isc_info_sql_explain_plan: 26
      // >= 3.0
    };
    var statementInfo = {
      isc_info_sql_stmt_select: 1,
      isc_info_sql_stmt_insert: 2,
      isc_info_sql_stmt_update: 3,
      isc_info_sql_stmt_delete: 4,
      isc_info_sql_stmt_ddl: 5,
      isc_info_sql_stmt_get_segment: 6,
      isc_info_sql_stmt_put_segment: 7,
      isc_info_sql_stmt_exec_procedure: 8,
      isc_info_sql_stmt_start_trans: 9,
      isc_info_sql_stmt_commit: 10,
      isc_info_sql_stmt_rollback: 11,
      isc_info_sql_stmt_select_for_upd: 12,
      isc_info_sql_stmt_set_generator: 13,
      isc_info_sql_stmt_savepoint: 14
    };
    var DESCRIBE = [
      sqlInfo.isc_info_sql_stmt_type,
      sqlInfo.isc_info_sql_select,
      sqlInfo.isc_info_sql_describe_vars,
      sqlInfo.isc_info_sql_sqlda_seq,
      sqlInfo.isc_info_sql_type,
      sqlInfo.isc_info_sql_sub_type,
      sqlInfo.isc_info_sql_scale,
      sqlInfo.isc_info_sql_length,
      sqlInfo.isc_info_sql_field,
      sqlInfo.isc_info_sql_relation,
      //isc_info_sql_owner,
      sqlInfo.isc_info_sql_alias,
      sqlInfo.isc_info_sql_describe_end,
      sqlInfo.isc_info_sql_bind,
      sqlInfo.isc_info_sql_describe_vars,
      sqlInfo.isc_info_sql_sqlda_seq,
      sqlInfo.isc_info_sql_type,
      sqlInfo.isc_info_sql_sub_type,
      sqlInfo.isc_info_sql_scale,
      sqlInfo.isc_info_sql_length,
      sqlInfo.isc_info_sql_describe_end
    ];
    var iscAction = {
      isc_action_svc_backup: 1,
      /* Starts database backup process on the server	*/
      isc_action_svc_restore: 2,
      /* Starts database restore process on the server */
      isc_action_svc_repair: 3,
      /* Starts database repair process on the server	*/
      isc_action_svc_add_user: 4,
      /* Adds	a new user to the security database	*/
      isc_action_svc_delete_user: 5,
      /* Deletes a user record from the security database	*/
      isc_action_svc_modify_user: 6,
      /* Modifies	a user record in the security database */
      isc_action_svc_display_user: 7,
      /* Displays	a user record from the security	database */
      isc_action_svc_properties: 8,
      /* Sets	database properties	*/
      isc_action_svc_add_license: 9,
      /* Adds	a license to the license file */
      isc_action_svc_remove_license: 10,
      /* Removes a license from the license file */
      isc_action_svc_db_stats: 11,
      /* Retrieves database statistics */
      isc_action_svc_get_ib_log: 12,
      /* Retrieves the InterBase log file	from the server	*/
      isc_action_svc_get_fb_log: 12,
      // isc_action_svc_get_ib_log, /* Retrieves the Firebird log file	from the server	*/
      isc_action_svc_nbak: 20,
      /* start nbackup */
      isc_action_svc_nrest: 21,
      /* start nrestore */
      isc_action_svc_trace_start: 22,
      isc_action_svc_trace_stop: 23,
      isc_action_svc_trace_suspend: 24,
      isc_action_svc_trace_resume: 25,
      isc_action_svc_trace_list: 26
    };
    var service = {
      isc_spb_prp_page_buffers: 5,
      isc_spb_prp_sweep_interval: 6,
      isc_spb_prp_shutdown_db: 7,
      isc_spb_prp_deny_new_attachments: 9,
      isc_spb_prp_deny_new_transactions: 10,
      isc_spb_prp_reserve_space: 11,
      isc_spb_prp_write_mode: 12,
      isc_spb_prp_access_mode: 13,
      isc_spb_prp_set_sql_dialect: 14,
      isc_spb_num_att: 5,
      isc_spb_num_db: 6,
      // SHUTDOWN OPTION FOR 2.0
      isc_spb_prp_force_shutdown: 41,
      isc_spb_prp_attachments_shutdown: 42,
      isc_spb_prp_transactions_shutdown: 43,
      isc_spb_prp_shutdown_mode: 44,
      isc_spb_prp_online_mode: 45,
      isc_spb_prp_sm_normal: 0,
      isc_spb_prp_sm_multi: 1,
      isc_spb_prp_sm_single: 2,
      isc_spb_prp_sm_full: 3,
      // WRITE_MODE_PARAMETERS
      isc_spb_prp_wm_async: 37,
      isc_spb_prp_wm_sync: 38,
      // ACCESS_MODE_PARAMETERS
      isc_spb_prp_am_readonly: 39,
      isc_spb_prp_am_readwrite: 40,
      // RESERVE_SPACE_PARAMETERS
      isc_spb_prp_res_use_full: 35,
      isc_spb_prp_res: 36,
      // Option Flags
      isc_spb_prp_activate: 256,
      isc_spb_prp_db_online: 512
    };
    var serviceInfo = {
      isc_info_svc_svr_db_info: 50,
      /* Retrieves the number	of attachments and databases */
      isc_info_svc_get_license: 51,
      /* Retrieves all license keys and IDs from the license file	*/
      isc_info_svc_get_license_mask: 52,
      /* Retrieves a bitmask representing	licensed options on	the	server */
      isc_info_svc_get_config: 53,
      /* Retrieves the parameters	and	values for IB_CONFIG */
      isc_info_svc_version: 54,
      /* Retrieves the version of	the	services manager */
      isc_info_svc_server_version: 55,
      /* Retrieves the version of	the	InterBase server */
      isc_info_svc_implementation: 56,
      /* Retrieves the implementation	of the InterBase server	*/
      isc_info_svc_capabilities: 57,
      /* Retrieves a bitmask representing	the	server's capabilities */
      isc_info_svc_user_dbpath: 58,
      /* Retrieves the path to the security database in use by the server	*/
      isc_info_svc_get_env: 59,
      /* Retrieves the setting of	$INTERBASE */
      isc_info_svc_get_env_lock: 60,
      /* Retrieves the setting of	$INTERBASE_LCK */
      isc_info_svc_get_env_msg: 61,
      /* Retrieves the setting of	$INTERBASE_MSG */
      isc_info_svc_line: 62,
      /* Retrieves 1 line	of service output per call */
      isc_info_svc_to_eof: 63,
      /* Retrieves as much of	the	server output as will fit in the supplied buffer */
      isc_info_svc_timeout: 64,
      /* Sets	/ signifies	a timeout value	for	reading	service	information	*/
      isc_info_svc_get_licensed_users: 65,
      /* Retrieves the number	of users licensed for accessing	the	server */
      isc_info_svc_limbo_trans: 66,
      /* Retrieve	the	limbo transactions */
      isc_info_svc_running: 67,
      /* Checks to see if	a service is running on	an attachment */
      isc_info_svc_get_users: 68,
      /* Returns the user	information	from isc_action_svc_display_users */
      isc_info_svc_stdin: 78
    };
    var spb = {
      isc_spb_version1: 1,
      isc_spb_current_version: 2,
      isc_spb_version: 2,
      // isc_spb_current_version,
      isc_spb_user_name: dpb.isc_dpb_user_name,
      isc_spb_sys_user_name: dpb.isc_dpb_sys_user_name,
      isc_spb_sys_user_name_enc: dpb.isc_dpb_sys_user_name_enc,
      isc_spb_password: dpb.isc_dpb_password,
      isc_spb_password_enc: dpb.isc_dpb_password_enc,
      isc_spb_command_line: 105,
      isc_spb_dbname: 106,
      isc_spb_verbose: 107,
      isc_spb_options: 108
    };
    var serviceBackup = {
      isc_spb_bkp_file: 5,
      isc_spb_bkp_factor: 6,
      isc_spb_bkp_length: 7,
      isc_spb_bkp_ignore_checksums: 1,
      isc_spb_bkp_ignore_limbo: 2,
      isc_spb_bkp_metadata_only: 4,
      isc_spb_bkp_no_garbage_collect: 8,
      isc_spb_bkp_old_descriptions: 16,
      isc_spb_bkp_non_transportable: 32,
      isc_spb_bkp_convert: 64,
      isc_spb_bkp_expand: 128,
      isc_spb_bkp_no_triggers: 32768,
      // nbackup
      isc_spb_nbk_level: 5,
      isc_spb_nbk_file: 6,
      isc_spb_nbk_direct: 7,
      isc_spb_nbk_no_triggers: 1
    };
    var serviceRestore = {
      isc_spb_res_buffers: 9,
      isc_spb_res_page_size: 10,
      isc_spb_res_length: 11,
      isc_spb_res_access_mode: 12,
      isc_spb_res_fix_fss_data: 13,
      isc_spb_res_fix_fss_metadata: 14,
      isc_spb_res_am_readonly: service.isc_spb_prp_am_readonly,
      isc_spb_res_am_readwrite: service.isc_spb_prp_am_readwrite,
      isc_spb_res_deactivate_idx: 256,
      isc_spb_res_no_shadow: 512,
      isc_spb_res_no_validity: 1024,
      isc_spb_res_one_at_a_time: 2048,
      isc_spb_res_replace: 4096,
      isc_spb_res_create: 8192,
      isc_spb_res_use_all_space: 16384
    };
    var serviceRepair = {
      isc_spb_rpr_commit_trans: 15,
      isc_spb_rpr_rollback_trans: 34,
      isc_spb_rpr_recover_two_phase: 17,
      isc_spb_tra_id: 18,
      isc_spb_single_tra_id: 19,
      isc_spb_multi_tra_id: 20,
      isc_spb_tra_state: 21,
      isc_spb_tra_state_limbo: 22,
      isc_spb_tra_state_commit: 23,
      isc_spb_tra_state_rollback: 24,
      isc_spb_tra_state_unknown: 25,
      isc_spb_tra_host_site: 26,
      isc_spb_tra_remote_site: 27,
      isc_spb_tra_db_path: 28,
      isc_spb_tra_advise: 29,
      isc_spb_tra_advise_commit: 30,
      isc_spb_tra_advise_rollback: 31,
      isc_spb_tra_advise_unknown: 33,
      isc_spb_rpr_validate_db: 1,
      isc_spb_rpr_sweep_db: 2,
      isc_spb_rpr_mend_db: 4,
      isc_spb_rpr_list_limbo_trans: 8,
      isc_spb_rpr_check_db: 16,
      isc_spb_rpr_ignore_checksum: 32,
      isc_spb_rpr_kill_shadows: 64,
      isc_spb_rpr_full: 128,
      isc_spb_rpr_icu: 2048
    };
    var serviceSecurity = {
      isc_spb_sec_userid: 5,
      isc_spb_sec_groupid: 6,
      isc_spb_sec_username: 7,
      isc_spb_sec_password: 8,
      isc_spb_sec_groupname: 9,
      isc_spb_sec_firstname: 10,
      isc_spb_sec_middlename: 11,
      isc_spb_sec_lastname: 12,
      isc_spb_sec_admin: 13
    };
    var serviceLicence = {
      isc_spb_lic_key: 5,
      isc_spb_lic_id: 6,
      isc_spb_lic_desc: 7
    };
    var serviceStatistics = {
      isc_spb_sts_data_pages: 1,
      isc_spb_sts_db_log: 2,
      isc_spb_sts_hdr_pages: 4,
      isc_spb_sts_idx_pages: 8,
      isc_spb_sts_sys_relations: 16,
      isc_spb_sts_record_versions: 32,
      isc_spb_sts_table: 64,
      isc_spb_sts_nocreation: 128
    };
    var serviceTrace = {
      isc_spb_trc_id: 1,
      isc_spb_trc_name: 2,
      isc_spb_trc_cfg: 3
    };
    module2.exports = Object.freeze({
      ...acceptType,
      ...authPlugin,
      ...authOptions,
      ...blr,
      ...blobType,
      ...buffer,
      ...cnct,
      ...common,
      ...connect,
      ...defaultOptions,
      DESCRIBE,
      ...dpb,
      ...dsql,
      ...int,
      ...iscAction,
      ...iscError,
      ...op,
      ...protocol,
      ...service,
      ...serviceBackup,
      ...serviceInfo,
      ...serviceLicence,
      ...serviceRestore,
      ...serviceRepair,
      ...serviceSecurity,
      ...serviceStatistics,
      ...serviceTrace,
      ...sqlInfo,
      ...sqlType,
      ...spb,
      ...statementInfo,
      SUPPORTED_PROTOCOL,
      ...tpb,
      ...transactionIsolation
    });
  }
});

// ../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/callback.js
var require_callback = __commonJS({
  "../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/callback.js"(exports2, module2) {
    function doError(obj, callback) {
      if (callback)
        callback(obj);
    }
    function isError(obj) {
      return Boolean(
        obj != null && typeof obj === "object" && !Array.isArray(obj) && obj.status
      );
    }
    function doCallback(obj, callback) {
      if (!callback)
        return;
      if (obj instanceof Error) {
        callback(obj);
        return;
      }
      if (isError(obj)) {
        var error = new Error(obj.message);
        var status = obj.status && obj.status.length && obj.status[0] || {};
        error.gdscode = status.gdscode;
        error.gdsparams = status.params;
        callback(error);
        return;
      }
      callback(void 0, obj);
    }
    module2.exports = {
      doError,
      doCallback
    };
  }
});

// ../node_modules/.pnpm/big-integer@1.6.52/node_modules/big-integer/BigInteger.js
var require_BigInteger = __commonJS({
  "../node_modules/.pnpm/big-integer@1.6.52/node_modules/big-integer/BigInteger.js"(exports2, module2) {
    var bigInt = function(undefined2) {
      "use strict";
      var BASE = 1e7, LOG_BASE = 7, MAX_INT = 9007199254740992, MAX_INT_ARR = smallToArray(MAX_INT), DEFAULT_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
      var supportsNativeBigInt = typeof BigInt === "function";
      function Integer(v, radix, alphabet, caseSensitive) {
        if (typeof v === "undefined") return Integer[0];
        if (typeof radix !== "undefined") return +radix === 10 && !alphabet ? parseValue(v) : parseBase(v, radix, alphabet, caseSensitive);
        return parseValue(v);
      }
      function BigInteger(value, sign) {
        this.value = value;
        this.sign = sign;
        this.isSmall = false;
      }
      BigInteger.prototype = Object.create(Integer.prototype);
      function SmallInteger(value) {
        this.value = value;
        this.sign = value < 0;
        this.isSmall = true;
      }
      SmallInteger.prototype = Object.create(Integer.prototype);
      function NativeBigInt(value) {
        this.value = value;
      }
      NativeBigInt.prototype = Object.create(Integer.prototype);
      function isPrecise(n) {
        return -MAX_INT < n && n < MAX_INT;
      }
      function smallToArray(n) {
        if (n < 1e7)
          return [n];
        if (n < 1e14)
          return [n % 1e7, Math.floor(n / 1e7)];
        return [n % 1e7, Math.floor(n / 1e7) % 1e7, Math.floor(n / 1e14)];
      }
      function arrayToSmall(arr) {
        trim(arr);
        var length = arr.length;
        if (length < 4 && compareAbs(arr, MAX_INT_ARR) < 0) {
          switch (length) {
            case 0:
              return 0;
            case 1:
              return arr[0];
            case 2:
              return arr[0] + arr[1] * BASE;
            default:
              return arr[0] + (arr[1] + arr[2] * BASE) * BASE;
          }
        }
        return arr;
      }
      function trim(v) {
        var i2 = v.length;
        while (v[--i2] === 0) ;
        v.length = i2 + 1;
      }
      function createArray(length) {
        var x = new Array(length);
        var i2 = -1;
        while (++i2 < length) {
          x[i2] = 0;
        }
        return x;
      }
      function truncate(n) {
        if (n > 0) return Math.floor(n);
        return Math.ceil(n);
      }
      function add(a, b) {
        var l_a = a.length, l_b = b.length, r = new Array(l_a), carry = 0, base = BASE, sum, i2;
        for (i2 = 0; i2 < l_b; i2++) {
          sum = a[i2] + b[i2] + carry;
          carry = sum >= base ? 1 : 0;
          r[i2] = sum - carry * base;
        }
        while (i2 < l_a) {
          sum = a[i2] + carry;
          carry = sum === base ? 1 : 0;
          r[i2++] = sum - carry * base;
        }
        if (carry > 0) r.push(carry);
        return r;
      }
      function addAny(a, b) {
        if (a.length >= b.length) return add(a, b);
        return add(b, a);
      }
      function addSmall(a, carry) {
        var l = a.length, r = new Array(l), base = BASE, sum, i2;
        for (i2 = 0; i2 < l; i2++) {
          sum = a[i2] - base + carry;
          carry = Math.floor(sum / base);
          r[i2] = sum - carry * base;
          carry += 1;
        }
        while (carry > 0) {
          r[i2++] = carry % base;
          carry = Math.floor(carry / base);
        }
        return r;
      }
      BigInteger.prototype.add = function(v) {
        var n = parseValue(v);
        if (this.sign !== n.sign) {
          return this.subtract(n.negate());
        }
        var a = this.value, b = n.value;
        if (n.isSmall) {
          return new BigInteger(addSmall(a, Math.abs(b)), this.sign);
        }
        return new BigInteger(addAny(a, b), this.sign);
      };
      BigInteger.prototype.plus = BigInteger.prototype.add;
      SmallInteger.prototype.add = function(v) {
        var n = parseValue(v);
        var a = this.value;
        if (a < 0 !== n.sign) {
          return this.subtract(n.negate());
        }
        var b = n.value;
        if (n.isSmall) {
          if (isPrecise(a + b)) return new SmallInteger(a + b);
          b = smallToArray(Math.abs(b));
        }
        return new BigInteger(addSmall(b, Math.abs(a)), a < 0);
      };
      SmallInteger.prototype.plus = SmallInteger.prototype.add;
      NativeBigInt.prototype.add = function(v) {
        return new NativeBigInt(this.value + parseValue(v).value);
      };
      NativeBigInt.prototype.plus = NativeBigInt.prototype.add;
      function subtract(a, b) {
        var a_l = a.length, b_l = b.length, r = new Array(a_l), borrow = 0, base = BASE, i2, difference;
        for (i2 = 0; i2 < b_l; i2++) {
          difference = a[i2] - borrow - b[i2];
          if (difference < 0) {
            difference += base;
            borrow = 1;
          } else borrow = 0;
          r[i2] = difference;
        }
        for (i2 = b_l; i2 < a_l; i2++) {
          difference = a[i2] - borrow;
          if (difference < 0) difference += base;
          else {
            r[i2++] = difference;
            break;
          }
          r[i2] = difference;
        }
        for (; i2 < a_l; i2++) {
          r[i2] = a[i2];
        }
        trim(r);
        return r;
      }
      function subtractAny(a, b, sign) {
        var value;
        if (compareAbs(a, b) >= 0) {
          value = subtract(a, b);
        } else {
          value = subtract(b, a);
          sign = !sign;
        }
        value = arrayToSmall(value);
        if (typeof value === "number") {
          if (sign) value = -value;
          return new SmallInteger(value);
        }
        return new BigInteger(value, sign);
      }
      function subtractSmall(a, b, sign) {
        var l = a.length, r = new Array(l), carry = -b, base = BASE, i2, difference;
        for (i2 = 0; i2 < l; i2++) {
          difference = a[i2] + carry;
          carry = Math.floor(difference / base);
          difference %= base;
          r[i2] = difference < 0 ? difference + base : difference;
        }
        r = arrayToSmall(r);
        if (typeof r === "number") {
          if (sign) r = -r;
          return new SmallInteger(r);
        }
        return new BigInteger(r, sign);
      }
      BigInteger.prototype.subtract = function(v) {
        var n = parseValue(v);
        if (this.sign !== n.sign) {
          return this.add(n.negate());
        }
        var a = this.value, b = n.value;
        if (n.isSmall)
          return subtractSmall(a, Math.abs(b), this.sign);
        return subtractAny(a, b, this.sign);
      };
      BigInteger.prototype.minus = BigInteger.prototype.subtract;
      SmallInteger.prototype.subtract = function(v) {
        var n = parseValue(v);
        var a = this.value;
        if (a < 0 !== n.sign) {
          return this.add(n.negate());
        }
        var b = n.value;
        if (n.isSmall) {
          return new SmallInteger(a - b);
        }
        return subtractSmall(b, Math.abs(a), a >= 0);
      };
      SmallInteger.prototype.minus = SmallInteger.prototype.subtract;
      NativeBigInt.prototype.subtract = function(v) {
        return new NativeBigInt(this.value - parseValue(v).value);
      };
      NativeBigInt.prototype.minus = NativeBigInt.prototype.subtract;
      BigInteger.prototype.negate = function() {
        return new BigInteger(this.value, !this.sign);
      };
      SmallInteger.prototype.negate = function() {
        var sign = this.sign;
        var small = new SmallInteger(-this.value);
        small.sign = !sign;
        return small;
      };
      NativeBigInt.prototype.negate = function() {
        return new NativeBigInt(-this.value);
      };
      BigInteger.prototype.abs = function() {
        return new BigInteger(this.value, false);
      };
      SmallInteger.prototype.abs = function() {
        return new SmallInteger(Math.abs(this.value));
      };
      NativeBigInt.prototype.abs = function() {
        return new NativeBigInt(this.value >= 0 ? this.value : -this.value);
      };
      function multiplyLong(a, b) {
        var a_l = a.length, b_l = b.length, l = a_l + b_l, r = createArray(l), base = BASE, product, carry, i2, a_i, b_j;
        for (i2 = 0; i2 < a_l; ++i2) {
          a_i = a[i2];
          for (var j = 0; j < b_l; ++j) {
            b_j = b[j];
            product = a_i * b_j + r[i2 + j];
            carry = Math.floor(product / base);
            r[i2 + j] = product - carry * base;
            r[i2 + j + 1] += carry;
          }
        }
        trim(r);
        return r;
      }
      function multiplySmall(a, b) {
        var l = a.length, r = new Array(l), base = BASE, carry = 0, product, i2;
        for (i2 = 0; i2 < l; i2++) {
          product = a[i2] * b + carry;
          carry = Math.floor(product / base);
          r[i2] = product - carry * base;
        }
        while (carry > 0) {
          r[i2++] = carry % base;
          carry = Math.floor(carry / base);
        }
        return r;
      }
      function shiftLeft(x, n) {
        var r = [];
        while (n-- > 0) r.push(0);
        return r.concat(x);
      }
      function multiplyKaratsuba(x, y) {
        var n = Math.max(x.length, y.length);
        if (n <= 30) return multiplyLong(x, y);
        n = Math.ceil(n / 2);
        var b = x.slice(n), a = x.slice(0, n), d = y.slice(n), c = y.slice(0, n);
        var ac = multiplyKaratsuba(a, c), bd = multiplyKaratsuba(b, d), abcd = multiplyKaratsuba(addAny(a, b), addAny(c, d));
        var product = addAny(addAny(ac, shiftLeft(subtract(subtract(abcd, ac), bd), n)), shiftLeft(bd, 2 * n));
        trim(product);
        return product;
      }
      function useKaratsuba(l1, l2) {
        return -0.012 * l1 - 0.012 * l2 + 15e-6 * l1 * l2 > 0;
      }
      BigInteger.prototype.multiply = function(v) {
        var n = parseValue(v), a = this.value, b = n.value, sign = this.sign !== n.sign, abs;
        if (n.isSmall) {
          if (b === 0) return Integer[0];
          if (b === 1) return this;
          if (b === -1) return this.negate();
          abs = Math.abs(b);
          if (abs < BASE) {
            return new BigInteger(multiplySmall(a, abs), sign);
          }
          b = smallToArray(abs);
        }
        if (useKaratsuba(a.length, b.length))
          return new BigInteger(multiplyKaratsuba(a, b), sign);
        return new BigInteger(multiplyLong(a, b), sign);
      };
      BigInteger.prototype.times = BigInteger.prototype.multiply;
      function multiplySmallAndArray(a, b, sign) {
        if (a < BASE) {
          return new BigInteger(multiplySmall(b, a), sign);
        }
        return new BigInteger(multiplyLong(b, smallToArray(a)), sign);
      }
      SmallInteger.prototype._multiplyBySmall = function(a) {
        if (isPrecise(a.value * this.value)) {
          return new SmallInteger(a.value * this.value);
        }
        return multiplySmallAndArray(Math.abs(a.value), smallToArray(Math.abs(this.value)), this.sign !== a.sign);
      };
      BigInteger.prototype._multiplyBySmall = function(a) {
        if (a.value === 0) return Integer[0];
        if (a.value === 1) return this;
        if (a.value === -1) return this.negate();
        return multiplySmallAndArray(Math.abs(a.value), this.value, this.sign !== a.sign);
      };
      SmallInteger.prototype.multiply = function(v) {
        return parseValue(v)._multiplyBySmall(this);
      };
      SmallInteger.prototype.times = SmallInteger.prototype.multiply;
      NativeBigInt.prototype.multiply = function(v) {
        return new NativeBigInt(this.value * parseValue(v).value);
      };
      NativeBigInt.prototype.times = NativeBigInt.prototype.multiply;
      function square(a) {
        var l = a.length, r = createArray(l + l), base = BASE, product, carry, i2, a_i, a_j;
        for (i2 = 0; i2 < l; i2++) {
          a_i = a[i2];
          carry = 0 - a_i * a_i;
          for (var j = i2; j < l; j++) {
            a_j = a[j];
            product = 2 * (a_i * a_j) + r[i2 + j] + carry;
            carry = Math.floor(product / base);
            r[i2 + j] = product - carry * base;
          }
          r[i2 + l] = carry;
        }
        trim(r);
        return r;
      }
      BigInteger.prototype.square = function() {
        return new BigInteger(square(this.value), false);
      };
      SmallInteger.prototype.square = function() {
        var value = this.value * this.value;
        if (isPrecise(value)) return new SmallInteger(value);
        return new BigInteger(square(smallToArray(Math.abs(this.value))), false);
      };
      NativeBigInt.prototype.square = function(v) {
        return new NativeBigInt(this.value * this.value);
      };
      function divMod1(a, b) {
        var a_l = a.length, b_l = b.length, base = BASE, result = createArray(b.length), divisorMostSignificantDigit = b[b_l - 1], lambda = Math.ceil(base / (2 * divisorMostSignificantDigit)), remainder = multiplySmall(a, lambda), divisor = multiplySmall(b, lambda), quotientDigit, shift, carry, borrow, i2, l, q;
        if (remainder.length <= a_l) remainder.push(0);
        divisor.push(0);
        divisorMostSignificantDigit = divisor[b_l - 1];
        for (shift = a_l - b_l; shift >= 0; shift--) {
          quotientDigit = base - 1;
          if (remainder[shift + b_l] !== divisorMostSignificantDigit) {
            quotientDigit = Math.floor((remainder[shift + b_l] * base + remainder[shift + b_l - 1]) / divisorMostSignificantDigit);
          }
          carry = 0;
          borrow = 0;
          l = divisor.length;
          for (i2 = 0; i2 < l; i2++) {
            carry += quotientDigit * divisor[i2];
            q = Math.floor(carry / base);
            borrow += remainder[shift + i2] - (carry - q * base);
            carry = q;
            if (borrow < 0) {
              remainder[shift + i2] = borrow + base;
              borrow = -1;
            } else {
              remainder[shift + i2] = borrow;
              borrow = 0;
            }
          }
          while (borrow !== 0) {
            quotientDigit -= 1;
            carry = 0;
            for (i2 = 0; i2 < l; i2++) {
              carry += remainder[shift + i2] - base + divisor[i2];
              if (carry < 0) {
                remainder[shift + i2] = carry + base;
                carry = 0;
              } else {
                remainder[shift + i2] = carry;
                carry = 1;
              }
            }
            borrow += carry;
          }
          result[shift] = quotientDigit;
        }
        remainder = divModSmall(remainder, lambda)[0];
        return [arrayToSmall(result), arrayToSmall(remainder)];
      }
      function divMod2(a, b) {
        var a_l = a.length, b_l = b.length, result = [], part = [], base = BASE, guess, xlen, highx, highy, check;
        while (a_l) {
          part.unshift(a[--a_l]);
          trim(part);
          if (compareAbs(part, b) < 0) {
            result.push(0);
            continue;
          }
          xlen = part.length;
          highx = part[xlen - 1] * base + part[xlen - 2];
          highy = b[b_l - 1] * base + b[b_l - 2];
          if (xlen > b_l) {
            highx = (highx + 1) * base;
          }
          guess = Math.ceil(highx / highy);
          do {
            check = multiplySmall(b, guess);
            if (compareAbs(check, part) <= 0) break;
            guess--;
          } while (guess);
          result.push(guess);
          part = subtract(part, check);
        }
        result.reverse();
        return [arrayToSmall(result), arrayToSmall(part)];
      }
      function divModSmall(value, lambda) {
        var length = value.length, quotient = createArray(length), base = BASE, i2, q, remainder, divisor;
        remainder = 0;
        for (i2 = length - 1; i2 >= 0; --i2) {
          divisor = remainder * base + value[i2];
          q = truncate(divisor / lambda);
          remainder = divisor - q * lambda;
          quotient[i2] = q | 0;
        }
        return [quotient, remainder | 0];
      }
      function divModAny(self2, v) {
        var value, n = parseValue(v);
        if (supportsNativeBigInt) {
          return [new NativeBigInt(self2.value / n.value), new NativeBigInt(self2.value % n.value)];
        }
        var a = self2.value, b = n.value;
        var quotient;
        if (b === 0) throw new Error("Cannot divide by zero");
        if (self2.isSmall) {
          if (n.isSmall) {
            return [new SmallInteger(truncate(a / b)), new SmallInteger(a % b)];
          }
          return [Integer[0], self2];
        }
        if (n.isSmall) {
          if (b === 1) return [self2, Integer[0]];
          if (b == -1) return [self2.negate(), Integer[0]];
          var abs = Math.abs(b);
          if (abs < BASE) {
            value = divModSmall(a, abs);
            quotient = arrayToSmall(value[0]);
            var remainder = value[1];
            if (self2.sign) remainder = -remainder;
            if (typeof quotient === "number") {
              if (self2.sign !== n.sign) quotient = -quotient;
              return [new SmallInteger(quotient), new SmallInteger(remainder)];
            }
            return [new BigInteger(quotient, self2.sign !== n.sign), new SmallInteger(remainder)];
          }
          b = smallToArray(abs);
        }
        var comparison = compareAbs(a, b);
        if (comparison === -1) return [Integer[0], self2];
        if (comparison === 0) return [Integer[self2.sign === n.sign ? 1 : -1], Integer[0]];
        if (a.length + b.length <= 200)
          value = divMod1(a, b);
        else value = divMod2(a, b);
        quotient = value[0];
        var qSign = self2.sign !== n.sign, mod = value[1], mSign = self2.sign;
        if (typeof quotient === "number") {
          if (qSign) quotient = -quotient;
          quotient = new SmallInteger(quotient);
        } else quotient = new BigInteger(quotient, qSign);
        if (typeof mod === "number") {
          if (mSign) mod = -mod;
          mod = new SmallInteger(mod);
        } else mod = new BigInteger(mod, mSign);
        return [quotient, mod];
      }
      BigInteger.prototype.divmod = function(v) {
        var result = divModAny(this, v);
        return {
          quotient: result[0],
          remainder: result[1]
        };
      };
      NativeBigInt.prototype.divmod = SmallInteger.prototype.divmod = BigInteger.prototype.divmod;
      BigInteger.prototype.divide = function(v) {
        return divModAny(this, v)[0];
      };
      NativeBigInt.prototype.over = NativeBigInt.prototype.divide = function(v) {
        return new NativeBigInt(this.value / parseValue(v).value);
      };
      SmallInteger.prototype.over = SmallInteger.prototype.divide = BigInteger.prototype.over = BigInteger.prototype.divide;
      BigInteger.prototype.mod = function(v) {
        return divModAny(this, v)[1];
      };
      NativeBigInt.prototype.mod = NativeBigInt.prototype.remainder = function(v) {
        return new NativeBigInt(this.value % parseValue(v).value);
      };
      SmallInteger.prototype.remainder = SmallInteger.prototype.mod = BigInteger.prototype.remainder = BigInteger.prototype.mod;
      BigInteger.prototype.pow = function(v) {
        var n = parseValue(v), a = this.value, b = n.value, value, x, y;
        if (b === 0) return Integer[1];
        if (a === 0) return Integer[0];
        if (a === 1) return Integer[1];
        if (a === -1) return n.isEven() ? Integer[1] : Integer[-1];
        if (n.sign) {
          return Integer[0];
        }
        if (!n.isSmall) throw new Error("The exponent " + n.toString() + " is too large.");
        if (this.isSmall) {
          if (isPrecise(value = Math.pow(a, b)))
            return new SmallInteger(truncate(value));
        }
        x = this;
        y = Integer[1];
        while (true) {
          if (b & true) {
            y = y.times(x);
            --b;
          }
          if (b === 0) break;
          b /= 2;
          x = x.square();
        }
        return y;
      };
      SmallInteger.prototype.pow = BigInteger.prototype.pow;
      NativeBigInt.prototype.pow = function(v) {
        var n = parseValue(v);
        var a = this.value, b = n.value;
        var _0 = BigInt(0), _1 = BigInt(1), _2 = BigInt(2);
        if (b === _0) return Integer[1];
        if (a === _0) return Integer[0];
        if (a === _1) return Integer[1];
        if (a === BigInt(-1)) return n.isEven() ? Integer[1] : Integer[-1];
        if (n.isNegative()) return new NativeBigInt(_0);
        var x = this;
        var y = Integer[1];
        while (true) {
          if ((b & _1) === _1) {
            y = y.times(x);
            --b;
          }
          if (b === _0) break;
          b /= _2;
          x = x.square();
        }
        return y;
      };
      BigInteger.prototype.modPow = function(exp, mod) {
        exp = parseValue(exp);
        mod = parseValue(mod);
        if (mod.isZero()) throw new Error("Cannot take modPow with modulus 0");
        var r = Integer[1], base = this.mod(mod);
        if (exp.isNegative()) {
          exp = exp.multiply(Integer[-1]);
          base = base.modInv(mod);
        }
        while (exp.isPositive()) {
          if (base.isZero()) return Integer[0];
          if (exp.isOdd()) r = r.multiply(base).mod(mod);
          exp = exp.divide(2);
          base = base.square().mod(mod);
        }
        return r;
      };
      NativeBigInt.prototype.modPow = SmallInteger.prototype.modPow = BigInteger.prototype.modPow;
      function compareAbs(a, b) {
        if (a.length !== b.length) {
          return a.length > b.length ? 1 : -1;
        }
        for (var i2 = a.length - 1; i2 >= 0; i2--) {
          if (a[i2] !== b[i2]) return a[i2] > b[i2] ? 1 : -1;
        }
        return 0;
      }
      BigInteger.prototype.compareAbs = function(v) {
        var n = parseValue(v), a = this.value, b = n.value;
        if (n.isSmall) return 1;
        return compareAbs(a, b);
      };
      SmallInteger.prototype.compareAbs = function(v) {
        var n = parseValue(v), a = Math.abs(this.value), b = n.value;
        if (n.isSmall) {
          b = Math.abs(b);
          return a === b ? 0 : a > b ? 1 : -1;
        }
        return -1;
      };
      NativeBigInt.prototype.compareAbs = function(v) {
        var a = this.value;
        var b = parseValue(v).value;
        a = a >= 0 ? a : -a;
        b = b >= 0 ? b : -b;
        return a === b ? 0 : a > b ? 1 : -1;
      };
      BigInteger.prototype.compare = function(v) {
        if (v === Infinity) {
          return -1;
        }
        if (v === -Infinity) {
          return 1;
        }
        var n = parseValue(v), a = this.value, b = n.value;
        if (this.sign !== n.sign) {
          return n.sign ? 1 : -1;
        }
        if (n.isSmall) {
          return this.sign ? -1 : 1;
        }
        return compareAbs(a, b) * (this.sign ? -1 : 1);
      };
      BigInteger.prototype.compareTo = BigInteger.prototype.compare;
      SmallInteger.prototype.compare = function(v) {
        if (v === Infinity) {
          return -1;
        }
        if (v === -Infinity) {
          return 1;
        }
        var n = parseValue(v), a = this.value, b = n.value;
        if (n.isSmall) {
          return a == b ? 0 : a > b ? 1 : -1;
        }
        if (a < 0 !== n.sign) {
          return a < 0 ? -1 : 1;
        }
        return a < 0 ? 1 : -1;
      };
      SmallInteger.prototype.compareTo = SmallInteger.prototype.compare;
      NativeBigInt.prototype.compare = function(v) {
        if (v === Infinity) {
          return -1;
        }
        if (v === -Infinity) {
          return 1;
        }
        var a = this.value;
        var b = parseValue(v).value;
        return a === b ? 0 : a > b ? 1 : -1;
      };
      NativeBigInt.prototype.compareTo = NativeBigInt.prototype.compare;
      BigInteger.prototype.equals = function(v) {
        return this.compare(v) === 0;
      };
      NativeBigInt.prototype.eq = NativeBigInt.prototype.equals = SmallInteger.prototype.eq = SmallInteger.prototype.equals = BigInteger.prototype.eq = BigInteger.prototype.equals;
      BigInteger.prototype.notEquals = function(v) {
        return this.compare(v) !== 0;
      };
      NativeBigInt.prototype.neq = NativeBigInt.prototype.notEquals = SmallInteger.prototype.neq = SmallInteger.prototype.notEquals = BigInteger.prototype.neq = BigInteger.prototype.notEquals;
      BigInteger.prototype.greater = function(v) {
        return this.compare(v) > 0;
      };
      NativeBigInt.prototype.gt = NativeBigInt.prototype.greater = SmallInteger.prototype.gt = SmallInteger.prototype.greater = BigInteger.prototype.gt = BigInteger.prototype.greater;
      BigInteger.prototype.lesser = function(v) {
        return this.compare(v) < 0;
      };
      NativeBigInt.prototype.lt = NativeBigInt.prototype.lesser = SmallInteger.prototype.lt = SmallInteger.prototype.lesser = BigInteger.prototype.lt = BigInteger.prototype.lesser;
      BigInteger.prototype.greaterOrEquals = function(v) {
        return this.compare(v) >= 0;
      };
      NativeBigInt.prototype.geq = NativeBigInt.prototype.greaterOrEquals = SmallInteger.prototype.geq = SmallInteger.prototype.greaterOrEquals = BigInteger.prototype.geq = BigInteger.prototype.greaterOrEquals;
      BigInteger.prototype.lesserOrEquals = function(v) {
        return this.compare(v) <= 0;
      };
      NativeBigInt.prototype.leq = NativeBigInt.prototype.lesserOrEquals = SmallInteger.prototype.leq = SmallInteger.prototype.lesserOrEquals = BigInteger.prototype.leq = BigInteger.prototype.lesserOrEquals;
      BigInteger.prototype.isEven = function() {
        return (this.value[0] & 1) === 0;
      };
      SmallInteger.prototype.isEven = function() {
        return (this.value & 1) === 0;
      };
      NativeBigInt.prototype.isEven = function() {
        return (this.value & BigInt(1)) === BigInt(0);
      };
      BigInteger.prototype.isOdd = function() {
        return (this.value[0] & 1) === 1;
      };
      SmallInteger.prototype.isOdd = function() {
        return (this.value & 1) === 1;
      };
      NativeBigInt.prototype.isOdd = function() {
        return (this.value & BigInt(1)) === BigInt(1);
      };
      BigInteger.prototype.isPositive = function() {
        return !this.sign;
      };
      SmallInteger.prototype.isPositive = function() {
        return this.value > 0;
      };
      NativeBigInt.prototype.isPositive = SmallInteger.prototype.isPositive;
      BigInteger.prototype.isNegative = function() {
        return this.sign;
      };
      SmallInteger.prototype.isNegative = function() {
        return this.value < 0;
      };
      NativeBigInt.prototype.isNegative = SmallInteger.prototype.isNegative;
      BigInteger.prototype.isUnit = function() {
        return false;
      };
      SmallInteger.prototype.isUnit = function() {
        return Math.abs(this.value) === 1;
      };
      NativeBigInt.prototype.isUnit = function() {
        return this.abs().value === BigInt(1);
      };
      BigInteger.prototype.isZero = function() {
        return false;
      };
      SmallInteger.prototype.isZero = function() {
        return this.value === 0;
      };
      NativeBigInt.prototype.isZero = function() {
        return this.value === BigInt(0);
      };
      BigInteger.prototype.isDivisibleBy = function(v) {
        var n = parseValue(v);
        if (n.isZero()) return false;
        if (n.isUnit()) return true;
        if (n.compareAbs(2) === 0) return this.isEven();
        return this.mod(n).isZero();
      };
      NativeBigInt.prototype.isDivisibleBy = SmallInteger.prototype.isDivisibleBy = BigInteger.prototype.isDivisibleBy;
      function isBasicPrime(v) {
        var n = v.abs();
        if (n.isUnit()) return false;
        if (n.equals(2) || n.equals(3) || n.equals(5)) return true;
        if (n.isEven() || n.isDivisibleBy(3) || n.isDivisibleBy(5)) return false;
        if (n.lesser(49)) return true;
      }
      function millerRabinTest(n, a) {
        var nPrev = n.prev(), b = nPrev, r = 0, d, t, i2, x;
        while (b.isEven()) b = b.divide(2), r++;
        next: for (i2 = 0; i2 < a.length; i2++) {
          if (n.lesser(a[i2])) continue;
          x = bigInt(a[i2]).modPow(b, n);
          if (x.isUnit() || x.equals(nPrev)) continue;
          for (d = r - 1; d != 0; d--) {
            x = x.square().mod(n);
            if (x.isUnit()) return false;
            if (x.equals(nPrev)) continue next;
          }
          return false;
        }
        return true;
      }
      BigInteger.prototype.isPrime = function(strict) {
        var isPrime = isBasicPrime(this);
        if (isPrime !== undefined2) return isPrime;
        var n = this.abs();
        var bits = n.bitLength();
        if (bits <= 64)
          return millerRabinTest(n, [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37]);
        var logN = Math.log(2) * bits.toJSNumber();
        var t = Math.ceil(strict === true ? 2 * Math.pow(logN, 2) : logN);
        for (var a = [], i2 = 0; i2 < t; i2++) {
          a.push(bigInt(i2 + 2));
        }
        return millerRabinTest(n, a);
      };
      NativeBigInt.prototype.isPrime = SmallInteger.prototype.isPrime = BigInteger.prototype.isPrime;
      BigInteger.prototype.isProbablePrime = function(iterations, rng) {
        var isPrime = isBasicPrime(this);
        if (isPrime !== undefined2) return isPrime;
        var n = this.abs();
        var t = iterations === undefined2 ? 5 : iterations;
        for (var a = [], i2 = 0; i2 < t; i2++) {
          a.push(bigInt.randBetween(2, n.minus(2), rng));
        }
        return millerRabinTest(n, a);
      };
      NativeBigInt.prototype.isProbablePrime = SmallInteger.prototype.isProbablePrime = BigInteger.prototype.isProbablePrime;
      BigInteger.prototype.modInv = function(n) {
        var t = bigInt.zero, newT = bigInt.one, r = parseValue(n), newR = this.abs(), q, lastT, lastR;
        while (!newR.isZero()) {
          q = r.divide(newR);
          lastT = t;
          lastR = r;
          t = newT;
          r = newR;
          newT = lastT.subtract(q.multiply(newT));
          newR = lastR.subtract(q.multiply(newR));
        }
        if (!r.isUnit()) throw new Error(this.toString() + " and " + n.toString() + " are not co-prime");
        if (t.compare(0) === -1) {
          t = t.add(n);
        }
        if (this.isNegative()) {
          return t.negate();
        }
        return t;
      };
      NativeBigInt.prototype.modInv = SmallInteger.prototype.modInv = BigInteger.prototype.modInv;
      BigInteger.prototype.next = function() {
        var value = this.value;
        if (this.sign) {
          return subtractSmall(value, 1, this.sign);
        }
        return new BigInteger(addSmall(value, 1), this.sign);
      };
      SmallInteger.prototype.next = function() {
        var value = this.value;
        if (value + 1 < MAX_INT) return new SmallInteger(value + 1);
        return new BigInteger(MAX_INT_ARR, false);
      };
      NativeBigInt.prototype.next = function() {
        return new NativeBigInt(this.value + BigInt(1));
      };
      BigInteger.prototype.prev = function() {
        var value = this.value;
        if (this.sign) {
          return new BigInteger(addSmall(value, 1), true);
        }
        return subtractSmall(value, 1, this.sign);
      };
      SmallInteger.prototype.prev = function() {
        var value = this.value;
        if (value - 1 > -MAX_INT) return new SmallInteger(value - 1);
        return new BigInteger(MAX_INT_ARR, true);
      };
      NativeBigInt.prototype.prev = function() {
        return new NativeBigInt(this.value - BigInt(1));
      };
      var powersOfTwo = [1];
      while (2 * powersOfTwo[powersOfTwo.length - 1] <= BASE) powersOfTwo.push(2 * powersOfTwo[powersOfTwo.length - 1]);
      var powers2Length = powersOfTwo.length, highestPower2 = powersOfTwo[powers2Length - 1];
      function shift_isSmall(n) {
        return Math.abs(n) <= BASE;
      }
      BigInteger.prototype.shiftLeft = function(v) {
        var n = parseValue(v).toJSNumber();
        if (!shift_isSmall(n)) {
          throw new Error(String(n) + " is too large for shifting.");
        }
        if (n < 0) return this.shiftRight(-n);
        var result = this;
        if (result.isZero()) return result;
        while (n >= powers2Length) {
          result = result.multiply(highestPower2);
          n -= powers2Length - 1;
        }
        return result.multiply(powersOfTwo[n]);
      };
      NativeBigInt.prototype.shiftLeft = SmallInteger.prototype.shiftLeft = BigInteger.prototype.shiftLeft;
      BigInteger.prototype.shiftRight = function(v) {
        var remQuo;
        var n = parseValue(v).toJSNumber();
        if (!shift_isSmall(n)) {
          throw new Error(String(n) + " is too large for shifting.");
        }
        if (n < 0) return this.shiftLeft(-n);
        var result = this;
        while (n >= powers2Length) {
          if (result.isZero() || result.isNegative() && result.isUnit()) return result;
          remQuo = divModAny(result, highestPower2);
          result = remQuo[1].isNegative() ? remQuo[0].prev() : remQuo[0];
          n -= powers2Length - 1;
        }
        remQuo = divModAny(result, powersOfTwo[n]);
        return remQuo[1].isNegative() ? remQuo[0].prev() : remQuo[0];
      };
      NativeBigInt.prototype.shiftRight = SmallInteger.prototype.shiftRight = BigInteger.prototype.shiftRight;
      function bitwise(x, y, fn) {
        y = parseValue(y);
        var xSign = x.isNegative(), ySign = y.isNegative();
        var xRem = xSign ? x.not() : x, yRem = ySign ? y.not() : y;
        var xDigit = 0, yDigit = 0;
        var xDivMod = null, yDivMod = null;
        var result = [];
        while (!xRem.isZero() || !yRem.isZero()) {
          xDivMod = divModAny(xRem, highestPower2);
          xDigit = xDivMod[1].toJSNumber();
          if (xSign) {
            xDigit = highestPower2 - 1 - xDigit;
          }
          yDivMod = divModAny(yRem, highestPower2);
          yDigit = yDivMod[1].toJSNumber();
          if (ySign) {
            yDigit = highestPower2 - 1 - yDigit;
          }
          xRem = xDivMod[0];
          yRem = yDivMod[0];
          result.push(fn(xDigit, yDigit));
        }
        var sum = fn(xSign ? 1 : 0, ySign ? 1 : 0) !== 0 ? bigInt(-1) : bigInt(0);
        for (var i2 = result.length - 1; i2 >= 0; i2 -= 1) {
          sum = sum.multiply(highestPower2).add(bigInt(result[i2]));
        }
        return sum;
      }
      BigInteger.prototype.not = function() {
        return this.negate().prev();
      };
      NativeBigInt.prototype.not = SmallInteger.prototype.not = BigInteger.prototype.not;
      BigInteger.prototype.and = function(n) {
        return bitwise(this, n, function(a, b) {
          return a & b;
        });
      };
      NativeBigInt.prototype.and = SmallInteger.prototype.and = BigInteger.prototype.and;
      BigInteger.prototype.or = function(n) {
        return bitwise(this, n, function(a, b) {
          return a | b;
        });
      };
      NativeBigInt.prototype.or = SmallInteger.prototype.or = BigInteger.prototype.or;
      BigInteger.prototype.xor = function(n) {
        return bitwise(this, n, function(a, b) {
          return a ^ b;
        });
      };
      NativeBigInt.prototype.xor = SmallInteger.prototype.xor = BigInteger.prototype.xor;
      var LOBMASK_I = 1 << 30, LOBMASK_BI = (BASE & -BASE) * (BASE & -BASE) | LOBMASK_I;
      function roughLOB(n) {
        var v = n.value, x = typeof v === "number" ? v | LOBMASK_I : typeof v === "bigint" ? v | BigInt(LOBMASK_I) : v[0] + v[1] * BASE | LOBMASK_BI;
        return x & -x;
      }
      function integerLogarithm(value, base) {
        if (base.compareTo(value) <= 0) {
          var tmp = integerLogarithm(value, base.square(base));
          var p = tmp.p;
          var e = tmp.e;
          var t = p.multiply(base);
          return t.compareTo(value) <= 0 ? { p: t, e: e * 2 + 1 } : { p, e: e * 2 };
        }
        return { p: bigInt(1), e: 0 };
      }
      BigInteger.prototype.bitLength = function() {
        var n = this;
        if (n.compareTo(bigInt(0)) < 0) {
          n = n.negate().subtract(bigInt(1));
        }
        if (n.compareTo(bigInt(0)) === 0) {
          return bigInt(0);
        }
        return bigInt(integerLogarithm(n, bigInt(2)).e).add(bigInt(1));
      };
      NativeBigInt.prototype.bitLength = SmallInteger.prototype.bitLength = BigInteger.prototype.bitLength;
      function max(a, b) {
        a = parseValue(a);
        b = parseValue(b);
        return a.greater(b) ? a : b;
      }
      function min(a, b) {
        a = parseValue(a);
        b = parseValue(b);
        return a.lesser(b) ? a : b;
      }
      function gcd(a, b) {
        a = parseValue(a).abs();
        b = parseValue(b).abs();
        if (a.equals(b)) return a;
        if (a.isZero()) return b;
        if (b.isZero()) return a;
        var c = Integer[1], d, t;
        while (a.isEven() && b.isEven()) {
          d = min(roughLOB(a), roughLOB(b));
          a = a.divide(d);
          b = b.divide(d);
          c = c.multiply(d);
        }
        while (a.isEven()) {
          a = a.divide(roughLOB(a));
        }
        do {
          while (b.isEven()) {
            b = b.divide(roughLOB(b));
          }
          if (a.greater(b)) {
            t = b;
            b = a;
            a = t;
          }
          b = b.subtract(a);
        } while (!b.isZero());
        return c.isUnit() ? a : a.multiply(c);
      }
      function lcm(a, b) {
        a = parseValue(a).abs();
        b = parseValue(b).abs();
        return a.divide(gcd(a, b)).multiply(b);
      }
      function randBetween(a, b, rng) {
        a = parseValue(a);
        b = parseValue(b);
        var usedRNG = rng || Math.random;
        var low = min(a, b), high = max(a, b);
        var range = high.subtract(low).add(1);
        if (range.isSmall) return low.add(Math.floor(usedRNG() * range));
        var digits = toBase(range, BASE).value;
        var result = [], restricted = true;
        for (var i2 = 0; i2 < digits.length; i2++) {
          var top = restricted ? digits[i2] + (i2 + 1 < digits.length ? digits[i2 + 1] / BASE : 0) : BASE;
          var digit = truncate(usedRNG() * top);
          result.push(digit);
          if (digit < digits[i2]) restricted = false;
        }
        return low.add(Integer.fromArray(result, BASE, false));
      }
      var parseBase = function(text, base, alphabet, caseSensitive) {
        alphabet = alphabet || DEFAULT_ALPHABET;
        text = String(text);
        if (!caseSensitive) {
          text = text.toLowerCase();
          alphabet = alphabet.toLowerCase();
        }
        var length = text.length;
        var i2;
        var absBase = Math.abs(base);
        var alphabetValues = {};
        for (i2 = 0; i2 < alphabet.length; i2++) {
          alphabetValues[alphabet[i2]] = i2;
        }
        for (i2 = 0; i2 < length; i2++) {
          var c = text[i2];
          if (c === "-") continue;
          if (c in alphabetValues) {
            if (alphabetValues[c] >= absBase) {
              if (c === "1" && absBase === 1) continue;
              throw new Error(c + " is not a valid digit in base " + base + ".");
            }
          }
        }
        base = parseValue(base);
        var digits = [];
        var isNegative = text[0] === "-";
        for (i2 = isNegative ? 1 : 0; i2 < text.length; i2++) {
          var c = text[i2];
          if (c in alphabetValues) digits.push(parseValue(alphabetValues[c]));
          else if (c === "<") {
            var start = i2;
            do {
              i2++;
            } while (text[i2] !== ">" && i2 < text.length);
            digits.push(parseValue(text.slice(start + 1, i2)));
          } else throw new Error(c + " is not a valid character");
        }
        return parseBaseFromArray(digits, base, isNegative);
      };
      function parseBaseFromArray(digits, base, isNegative) {
        var val = Integer[0], pow = Integer[1], i2;
        for (i2 = digits.length - 1; i2 >= 0; i2--) {
          val = val.add(digits[i2].times(pow));
          pow = pow.times(base);
        }
        return isNegative ? val.negate() : val;
      }
      function stringify(digit, alphabet) {
        alphabet = alphabet || DEFAULT_ALPHABET;
        if (digit < alphabet.length) {
          return alphabet[digit];
        }
        return "<" + digit + ">";
      }
      function toBase(n, base) {
        base = bigInt(base);
        if (base.isZero()) {
          if (n.isZero()) return { value: [0], isNegative: false };
          throw new Error("Cannot convert nonzero numbers to base 0.");
        }
        if (base.equals(-1)) {
          if (n.isZero()) return { value: [0], isNegative: false };
          if (n.isNegative())
            return {
              value: [].concat.apply(
                [],
                Array.apply(null, Array(-n.toJSNumber())).map(Array.prototype.valueOf, [1, 0])
              ),
              isNegative: false
            };
          var arr = Array.apply(null, Array(n.toJSNumber() - 1)).map(Array.prototype.valueOf, [0, 1]);
          arr.unshift([1]);
          return {
            value: [].concat.apply([], arr),
            isNegative: false
          };
        }
        var neg = false;
        if (n.isNegative() && base.isPositive()) {
          neg = true;
          n = n.abs();
        }
        if (base.isUnit()) {
          if (n.isZero()) return { value: [0], isNegative: false };
          return {
            value: Array.apply(null, Array(n.toJSNumber())).map(Number.prototype.valueOf, 1),
            isNegative: neg
          };
        }
        var out = [];
        var left = n, divmod;
        while (left.isNegative() || left.compareAbs(base) >= 0) {
          divmod = left.divmod(base);
          left = divmod.quotient;
          var digit = divmod.remainder;
          if (digit.isNegative()) {
            digit = base.minus(digit).abs();
            left = left.next();
          }
          out.push(digit.toJSNumber());
        }
        out.push(left.toJSNumber());
        return { value: out.reverse(), isNegative: neg };
      }
      function toBaseString(n, base, alphabet) {
        var arr = toBase(n, base);
        return (arr.isNegative ? "-" : "") + arr.value.map(function(x) {
          return stringify(x, alphabet);
        }).join("");
      }
      BigInteger.prototype.toArray = function(radix) {
        return toBase(this, radix);
      };
      SmallInteger.prototype.toArray = function(radix) {
        return toBase(this, radix);
      };
      NativeBigInt.prototype.toArray = function(radix) {
        return toBase(this, radix);
      };
      BigInteger.prototype.toString = function(radix, alphabet) {
        if (radix === undefined2) radix = 10;
        if (radix !== 10 || alphabet) return toBaseString(this, radix, alphabet);
        var v = this.value, l = v.length, str = String(v[--l]), zeros = "0000000", digit;
        while (--l >= 0) {
          digit = String(v[l]);
          str += zeros.slice(digit.length) + digit;
        }
        var sign = this.sign ? "-" : "";
        return sign + str;
      };
      SmallInteger.prototype.toString = function(radix, alphabet) {
        if (radix === undefined2) radix = 10;
        if (radix != 10 || alphabet) return toBaseString(this, radix, alphabet);
        return String(this.value);
      };
      NativeBigInt.prototype.toString = SmallInteger.prototype.toString;
      NativeBigInt.prototype.toJSON = BigInteger.prototype.toJSON = SmallInteger.prototype.toJSON = function() {
        return this.toString();
      };
      BigInteger.prototype.valueOf = function() {
        return parseInt(this.toString(), 10);
      };
      BigInteger.prototype.toJSNumber = BigInteger.prototype.valueOf;
      SmallInteger.prototype.valueOf = function() {
        return this.value;
      };
      SmallInteger.prototype.toJSNumber = SmallInteger.prototype.valueOf;
      NativeBigInt.prototype.valueOf = NativeBigInt.prototype.toJSNumber = function() {
        return parseInt(this.toString(), 10);
      };
      function parseStringValue(v) {
        if (isPrecise(+v)) {
          var x = +v;
          if (x === truncate(x))
            return supportsNativeBigInt ? new NativeBigInt(BigInt(x)) : new SmallInteger(x);
          throw new Error("Invalid integer: " + v);
        }
        var sign = v[0] === "-";
        if (sign) v = v.slice(1);
        var split = v.split(/e/i);
        if (split.length > 2) throw new Error("Invalid integer: " + split.join("e"));
        if (split.length === 2) {
          var exp = split[1];
          if (exp[0] === "+") exp = exp.slice(1);
          exp = +exp;
          if (exp !== truncate(exp) || !isPrecise(exp)) throw new Error("Invalid integer: " + exp + " is not a valid exponent.");
          var text = split[0];
          var decimalPlace = text.indexOf(".");
          if (decimalPlace >= 0) {
            exp -= text.length - decimalPlace - 1;
            text = text.slice(0, decimalPlace) + text.slice(decimalPlace + 1);
          }
          if (exp < 0) throw new Error("Cannot include negative exponent part for integers");
          text += new Array(exp + 1).join("0");
          v = text;
        }
        var isValid2 = /^([0-9][0-9]*)$/.test(v);
        if (!isValid2) throw new Error("Invalid integer: " + v);
        if (supportsNativeBigInt) {
          return new NativeBigInt(BigInt(sign ? "-" + v : v));
        }
        var r = [], max2 = v.length, l = LOG_BASE, min2 = max2 - l;
        while (max2 > 0) {
          r.push(+v.slice(min2, max2));
          min2 -= l;
          if (min2 < 0) min2 = 0;
          max2 -= l;
        }
        trim(r);
        return new BigInteger(r, sign);
      }
      function parseNumberValue(v) {
        if (supportsNativeBigInt) {
          return new NativeBigInt(BigInt(v));
        }
        if (isPrecise(v)) {
          if (v !== truncate(v)) throw new Error(v + " is not an integer.");
          return new SmallInteger(v);
        }
        return parseStringValue(v.toString());
      }
      function parseValue(v) {
        if (typeof v === "number") {
          return parseNumberValue(v);
        }
        if (typeof v === "string") {
          return parseStringValue(v);
        }
        if (typeof v === "bigint") {
          return new NativeBigInt(v);
        }
        return v;
      }
      for (var i = 0; i < 1e3; i++) {
        Integer[i] = parseValue(i);
        if (i > 0) Integer[-i] = parseValue(-i);
      }
      Integer.one = Integer[1];
      Integer.zero = Integer[0];
      Integer.minusOne = Integer[-1];
      Integer.max = max;
      Integer.min = min;
      Integer.gcd = gcd;
      Integer.lcm = lcm;
      Integer.isInstance = function(x) {
        return x instanceof BigInteger || x instanceof SmallInteger || x instanceof NativeBigInt;
      };
      Integer.randBetween = randBetween;
      Integer.fromArray = function(digits, base, isNegative) {
        return parseBaseFromArray(digits.map(parseValue), parseValue(base || 10), isNegative);
      };
      return Integer;
    }();
    if (typeof module2 !== "undefined" && module2.hasOwnProperty("exports")) {
      module2.exports = bigInt;
    }
    if (typeof define === "function" && define.amd) {
      define(function() {
        return bigInt;
      });
    }
  }
});

// ../node_modules/.pnpm/long@5.3.2/node_modules/long/umd/index.js
var require_umd = __commonJS({
  "../node_modules/.pnpm/long@5.3.2/node_modules/long/umd/index.js"(exports2, module2) {
    (function(global2, factory) {
      function preferDefault(exports3) {
        return exports3.default || exports3;
      }
      if (typeof define === "function" && define.amd) {
        define([], function() {
          var exports3 = {};
          factory(exports3);
          return preferDefault(exports3);
        });
      } else if (typeof exports2 === "object") {
        factory(exports2);
        if (typeof module2 === "object") module2.exports = preferDefault(exports2);
      } else {
        (function() {
          var exports3 = {};
          factory(exports3);
          global2.Long = preferDefault(exports3);
        })();
      }
    })(
      typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : exports2,
      function(_exports) {
        "use strict";
        Object.defineProperty(_exports, "__esModule", {
          value: true
        });
        _exports.default = void 0;
        var wasm = null;
        try {
          wasm = new WebAssembly.Instance(
            new WebAssembly.Module(
              new Uint8Array([
                // \0asm
                0,
                97,
                115,
                109,
                // version 1
                1,
                0,
                0,
                0,
                // section "type"
                1,
                13,
                2,
                // 0, () => i32
                96,
                0,
                1,
                127,
                // 1, (i32, i32, i32, i32) => i32
                96,
                4,
                127,
                127,
                127,
                127,
                1,
                127,
                // section "function"
                3,
                7,
                6,
                // 0, type 0
                0,
                // 1, type 1
                1,
                // 2, type 1
                1,
                // 3, type 1
                1,
                // 4, type 1
                1,
                // 5, type 1
                1,
                // section "global"
                6,
                6,
                1,
                // 0, "high", mutable i32
                127,
                1,
                65,
                0,
                11,
                // section "export"
                7,
                50,
                6,
                // 0, "mul"
                3,
                109,
                117,
                108,
                0,
                1,
                // 1, "div_s"
                5,
                100,
                105,
                118,
                95,
                115,
                0,
                2,
                // 2, "div_u"
                5,
                100,
                105,
                118,
                95,
                117,
                0,
                3,
                // 3, "rem_s"
                5,
                114,
                101,
                109,
                95,
                115,
                0,
                4,
                // 4, "rem_u"
                5,
                114,
                101,
                109,
                95,
                117,
                0,
                5,
                // 5, "get_high"
                8,
                103,
                101,
                116,
                95,
                104,
                105,
                103,
                104,
                0,
                0,
                // section "code"
                10,
                191,
                1,
                6,
                // 0, "get_high"
                4,
                0,
                35,
                0,
                11,
                // 1, "mul"
                36,
                1,
                1,
                126,
                32,
                0,
                173,
                32,
                1,
                173,
                66,
                32,
                134,
                132,
                32,
                2,
                173,
                32,
                3,
                173,
                66,
                32,
                134,
                132,
                126,
                34,
                4,
                66,
                32,
                135,
                167,
                36,
                0,
                32,
                4,
                167,
                11,
                // 2, "div_s"
                36,
                1,
                1,
                126,
                32,
                0,
                173,
                32,
                1,
                173,
                66,
                32,
                134,
                132,
                32,
                2,
                173,
                32,
                3,
                173,
                66,
                32,
                134,
                132,
                127,
                34,
                4,
                66,
                32,
                135,
                167,
                36,
                0,
                32,
                4,
                167,
                11,
                // 3, "div_u"
                36,
                1,
                1,
                126,
                32,
                0,
                173,
                32,
                1,
                173,
                66,
                32,
                134,
                132,
                32,
                2,
                173,
                32,
                3,
                173,
                66,
                32,
                134,
                132,
                128,
                34,
                4,
                66,
                32,
                135,
                167,
                36,
                0,
                32,
                4,
                167,
                11,
                // 4, "rem_s"
                36,
                1,
                1,
                126,
                32,
                0,
                173,
                32,
                1,
                173,
                66,
                32,
                134,
                132,
                32,
                2,
                173,
                32,
                3,
                173,
                66,
                32,
                134,
                132,
                129,
                34,
                4,
                66,
                32,
                135,
                167,
                36,
                0,
                32,
                4,
                167,
                11,
                // 5, "rem_u"
                36,
                1,
                1,
                126,
                32,
                0,
                173,
                32,
                1,
                173,
                66,
                32,
                134,
                132,
                32,
                2,
                173,
                32,
                3,
                173,
                66,
                32,
                134,
                132,
                130,
                34,
                4,
                66,
                32,
                135,
                167,
                36,
                0,
                32,
                4,
                167,
                11
              ])
            ),
            {}
          ).exports;
        } catch {
        }
        function Long(low, high, unsigned) {
          this.low = low | 0;
          this.high = high | 0;
          this.unsigned = !!unsigned;
        }
        Long.prototype.__isLong__;
        Object.defineProperty(Long.prototype, "__isLong__", {
          value: true
        });
        function isLong(obj) {
          return (obj && obj["__isLong__"]) === true;
        }
        function ctz32(value) {
          var c = Math.clz32(value & -value);
          return value ? 31 - c : c;
        }
        Long.isLong = isLong;
        var INT_CACHE = {};
        var UINT_CACHE = {};
        function fromInt(value, unsigned) {
          var obj, cachedObj, cache;
          if (unsigned) {
            value >>>= 0;
            if (cache = 0 <= value && value < 256) {
              cachedObj = UINT_CACHE[value];
              if (cachedObj) return cachedObj;
            }
            obj = fromBits(value, 0, true);
            if (cache) UINT_CACHE[value] = obj;
            return obj;
          } else {
            value |= 0;
            if (cache = -128 <= value && value < 128) {
              cachedObj = INT_CACHE[value];
              if (cachedObj) return cachedObj;
            }
            obj = fromBits(value, value < 0 ? -1 : 0, false);
            if (cache) INT_CACHE[value] = obj;
            return obj;
          }
        }
        Long.fromInt = fromInt;
        function fromNumber(value, unsigned) {
          if (isNaN(value)) return unsigned ? UZERO : ZERO;
          if (unsigned) {
            if (value < 0) return UZERO;
            if (value >= TWO_PWR_64_DBL) return MAX_UNSIGNED_VALUE;
          } else {
            if (value <= -TWO_PWR_63_DBL) return MIN_VALUE;
            if (value + 1 >= TWO_PWR_63_DBL) return MAX_VALUE;
          }
          if (value < 0) return fromNumber(-value, unsigned).neg();
          return fromBits(
            value % TWO_PWR_32_DBL | 0,
            value / TWO_PWR_32_DBL | 0,
            unsigned
          );
        }
        Long.fromNumber = fromNumber;
        function fromBits(lowBits, highBits, unsigned) {
          return new Long(lowBits, highBits, unsigned);
        }
        Long.fromBits = fromBits;
        var pow_dbl = Math.pow;
        function fromString(str, unsigned, radix) {
          if (str.length === 0) throw Error("empty string");
          if (typeof unsigned === "number") {
            radix = unsigned;
            unsigned = false;
          } else {
            unsigned = !!unsigned;
          }
          if (str === "NaN" || str === "Infinity" || str === "+Infinity" || str === "-Infinity")
            return unsigned ? UZERO : ZERO;
          radix = radix || 10;
          if (radix < 2 || 36 < radix) throw RangeError("radix");
          var p;
          if ((p = str.indexOf("-")) > 0) throw Error("interior hyphen");
          else if (p === 0) {
            return fromString(str.substring(1), unsigned, radix).neg();
          }
          var radixToPower = fromNumber(pow_dbl(radix, 8));
          var result = ZERO;
          for (var i = 0; i < str.length; i += 8) {
            var size = Math.min(8, str.length - i), value = parseInt(str.substring(i, i + size), radix);
            if (size < 8) {
              var power = fromNumber(pow_dbl(radix, size));
              result = result.mul(power).add(fromNumber(value));
            } else {
              result = result.mul(radixToPower);
              result = result.add(fromNumber(value));
            }
          }
          result.unsigned = unsigned;
          return result;
        }
        Long.fromString = fromString;
        function fromValue(val, unsigned) {
          if (typeof val === "number") return fromNumber(val, unsigned);
          if (typeof val === "string") return fromString(val, unsigned);
          return fromBits(
            val.low,
            val.high,
            typeof unsigned === "boolean" ? unsigned : val.unsigned
          );
        }
        Long.fromValue = fromValue;
        var TWO_PWR_16_DBL = 1 << 16;
        var TWO_PWR_24_DBL = 1 << 24;
        var TWO_PWR_32_DBL = TWO_PWR_16_DBL * TWO_PWR_16_DBL;
        var TWO_PWR_64_DBL = TWO_PWR_32_DBL * TWO_PWR_32_DBL;
        var TWO_PWR_63_DBL = TWO_PWR_64_DBL / 2;
        var TWO_PWR_24 = fromInt(TWO_PWR_24_DBL);
        var ZERO = fromInt(0);
        Long.ZERO = ZERO;
        var UZERO = fromInt(0, true);
        Long.UZERO = UZERO;
        var ONE = fromInt(1);
        Long.ONE = ONE;
        var UONE = fromInt(1, true);
        Long.UONE = UONE;
        var NEG_ONE = fromInt(-1);
        Long.NEG_ONE = NEG_ONE;
        var MAX_VALUE = fromBits(4294967295 | 0, 2147483647 | 0, false);
        Long.MAX_VALUE = MAX_VALUE;
        var MAX_UNSIGNED_VALUE = fromBits(4294967295 | 0, 4294967295 | 0, true);
        Long.MAX_UNSIGNED_VALUE = MAX_UNSIGNED_VALUE;
        var MIN_VALUE = fromBits(0, 2147483648 | 0, false);
        Long.MIN_VALUE = MIN_VALUE;
        var LongPrototype = Long.prototype;
        LongPrototype.toInt = function toInt() {
          return this.unsigned ? this.low >>> 0 : this.low;
        };
        LongPrototype.toNumber = function toNumber() {
          if (this.unsigned)
            return (this.high >>> 0) * TWO_PWR_32_DBL + (this.low >>> 0);
          return this.high * TWO_PWR_32_DBL + (this.low >>> 0);
        };
        LongPrototype.toString = function toString(radix) {
          radix = radix || 10;
          if (radix < 2 || 36 < radix) throw RangeError("radix");
          if (this.isZero()) return "0";
          if (this.isNegative()) {
            if (this.eq(MIN_VALUE)) {
              var radixLong = fromNumber(radix), div = this.div(radixLong), rem1 = div.mul(radixLong).sub(this);
              return div.toString(radix) + rem1.toInt().toString(radix);
            } else return "-" + this.neg().toString(radix);
          }
          var radixToPower = fromNumber(pow_dbl(radix, 6), this.unsigned), rem = this;
          var result = "";
          while (true) {
            var remDiv = rem.div(radixToPower), intval = rem.sub(remDiv.mul(radixToPower)).toInt() >>> 0, digits = intval.toString(radix);
            rem = remDiv;
            if (rem.isZero()) return digits + result;
            else {
              while (digits.length < 6) digits = "0" + digits;
              result = "" + digits + result;
            }
          }
        };
        LongPrototype.getHighBits = function getHighBits() {
          return this.high;
        };
        LongPrototype.getHighBitsUnsigned = function getHighBitsUnsigned() {
          return this.high >>> 0;
        };
        LongPrototype.getLowBits = function getLowBits() {
          return this.low;
        };
        LongPrototype.getLowBitsUnsigned = function getLowBitsUnsigned() {
          return this.low >>> 0;
        };
        LongPrototype.getNumBitsAbs = function getNumBitsAbs() {
          if (this.isNegative())
            return this.eq(MIN_VALUE) ? 64 : this.neg().getNumBitsAbs();
          var val = this.high != 0 ? this.high : this.low;
          for (var bit = 31; bit > 0; bit--) if ((val & 1 << bit) != 0) break;
          return this.high != 0 ? bit + 33 : bit + 1;
        };
        LongPrototype.isSafeInteger = function isSafeInteger() {
          var top11Bits = this.high >> 21;
          if (!top11Bits) return true;
          if (this.unsigned) return false;
          return top11Bits === -1 && !(this.low === 0 && this.high === -2097152);
        };
        LongPrototype.isZero = function isZero() {
          return this.high === 0 && this.low === 0;
        };
        LongPrototype.eqz = LongPrototype.isZero;
        LongPrototype.isNegative = function isNegative() {
          return !this.unsigned && this.high < 0;
        };
        LongPrototype.isPositive = function isPositive() {
          return this.unsigned || this.high >= 0;
        };
        LongPrototype.isOdd = function isOdd() {
          return (this.low & 1) === 1;
        };
        LongPrototype.isEven = function isEven() {
          return (this.low & 1) === 0;
        };
        LongPrototype.equals = function equals(other) {
          if (!isLong(other)) other = fromValue(other);
          if (this.unsigned !== other.unsigned && this.high >>> 31 === 1 && other.high >>> 31 === 1)
            return false;
          return this.high === other.high && this.low === other.low;
        };
        LongPrototype.eq = LongPrototype.equals;
        LongPrototype.notEquals = function notEquals(other) {
          return !this.eq(
            /* validates */
            other
          );
        };
        LongPrototype.neq = LongPrototype.notEquals;
        LongPrototype.ne = LongPrototype.notEquals;
        LongPrototype.lessThan = function lessThan(other) {
          return this.comp(
            /* validates */
            other
          ) < 0;
        };
        LongPrototype.lt = LongPrototype.lessThan;
        LongPrototype.lessThanOrEqual = function lessThanOrEqual(other) {
          return this.comp(
            /* validates */
            other
          ) <= 0;
        };
        LongPrototype.lte = LongPrototype.lessThanOrEqual;
        LongPrototype.le = LongPrototype.lessThanOrEqual;
        LongPrototype.greaterThan = function greaterThan(other) {
          return this.comp(
            /* validates */
            other
          ) > 0;
        };
        LongPrototype.gt = LongPrototype.greaterThan;
        LongPrototype.greaterThanOrEqual = function greaterThanOrEqual(other) {
          return this.comp(
            /* validates */
            other
          ) >= 0;
        };
        LongPrototype.gte = LongPrototype.greaterThanOrEqual;
        LongPrototype.ge = LongPrototype.greaterThanOrEqual;
        LongPrototype.compare = function compare(other) {
          if (!isLong(other)) other = fromValue(other);
          if (this.eq(other)) return 0;
          var thisNeg = this.isNegative(), otherNeg = other.isNegative();
          if (thisNeg && !otherNeg) return -1;
          if (!thisNeg && otherNeg) return 1;
          if (!this.unsigned) return this.sub(other).isNegative() ? -1 : 1;
          return other.high >>> 0 > this.high >>> 0 || other.high === this.high && other.low >>> 0 > this.low >>> 0 ? -1 : 1;
        };
        LongPrototype.comp = LongPrototype.compare;
        LongPrototype.negate = function negate() {
          if (!this.unsigned && this.eq(MIN_VALUE)) return MIN_VALUE;
          return this.not().add(ONE);
        };
        LongPrototype.neg = LongPrototype.negate;
        LongPrototype.add = function add(addend) {
          if (!isLong(addend)) addend = fromValue(addend);
          var a48 = this.high >>> 16;
          var a32 = this.high & 65535;
          var a16 = this.low >>> 16;
          var a00 = this.low & 65535;
          var b48 = addend.high >>> 16;
          var b32 = addend.high & 65535;
          var b16 = addend.low >>> 16;
          var b00 = addend.low & 65535;
          var c48 = 0, c32 = 0, c16 = 0, c00 = 0;
          c00 += a00 + b00;
          c16 += c00 >>> 16;
          c00 &= 65535;
          c16 += a16 + b16;
          c32 += c16 >>> 16;
          c16 &= 65535;
          c32 += a32 + b32;
          c48 += c32 >>> 16;
          c32 &= 65535;
          c48 += a48 + b48;
          c48 &= 65535;
          return fromBits(c16 << 16 | c00, c48 << 16 | c32, this.unsigned);
        };
        LongPrototype.subtract = function subtract(subtrahend) {
          if (!isLong(subtrahend)) subtrahend = fromValue(subtrahend);
          return this.add(subtrahend.neg());
        };
        LongPrototype.sub = LongPrototype.subtract;
        LongPrototype.multiply = function multiply(multiplier) {
          if (this.isZero()) return this;
          if (!isLong(multiplier)) multiplier = fromValue(multiplier);
          if (wasm) {
            var low = wasm["mul"](
              this.low,
              this.high,
              multiplier.low,
              multiplier.high
            );
            return fromBits(low, wasm["get_high"](), this.unsigned);
          }
          if (multiplier.isZero()) return this.unsigned ? UZERO : ZERO;
          if (this.eq(MIN_VALUE)) return multiplier.isOdd() ? MIN_VALUE : ZERO;
          if (multiplier.eq(MIN_VALUE)) return this.isOdd() ? MIN_VALUE : ZERO;
          if (this.isNegative()) {
            if (multiplier.isNegative()) return this.neg().mul(multiplier.neg());
            else return this.neg().mul(multiplier).neg();
          } else if (multiplier.isNegative())
            return this.mul(multiplier.neg()).neg();
          if (this.lt(TWO_PWR_24) && multiplier.lt(TWO_PWR_24))
            return fromNumber(
              this.toNumber() * multiplier.toNumber(),
              this.unsigned
            );
          var a48 = this.high >>> 16;
          var a32 = this.high & 65535;
          var a16 = this.low >>> 16;
          var a00 = this.low & 65535;
          var b48 = multiplier.high >>> 16;
          var b32 = multiplier.high & 65535;
          var b16 = multiplier.low >>> 16;
          var b00 = multiplier.low & 65535;
          var c48 = 0, c32 = 0, c16 = 0, c00 = 0;
          c00 += a00 * b00;
          c16 += c00 >>> 16;
          c00 &= 65535;
          c16 += a16 * b00;
          c32 += c16 >>> 16;
          c16 &= 65535;
          c16 += a00 * b16;
          c32 += c16 >>> 16;
          c16 &= 65535;
          c32 += a32 * b00;
          c48 += c32 >>> 16;
          c32 &= 65535;
          c32 += a16 * b16;
          c48 += c32 >>> 16;
          c32 &= 65535;
          c32 += a00 * b32;
          c48 += c32 >>> 16;
          c32 &= 65535;
          c48 += a48 * b00 + a32 * b16 + a16 * b32 + a00 * b48;
          c48 &= 65535;
          return fromBits(c16 << 16 | c00, c48 << 16 | c32, this.unsigned);
        };
        LongPrototype.mul = LongPrototype.multiply;
        LongPrototype.divide = function divide(divisor) {
          if (!isLong(divisor)) divisor = fromValue(divisor);
          if (divisor.isZero()) throw Error("division by zero");
          if (wasm) {
            if (!this.unsigned && this.high === -2147483648 && divisor.low === -1 && divisor.high === -1) {
              return this;
            }
            var low = (this.unsigned ? wasm["div_u"] : wasm["div_s"])(
              this.low,
              this.high,
              divisor.low,
              divisor.high
            );
            return fromBits(low, wasm["get_high"](), this.unsigned);
          }
          if (this.isZero()) return this.unsigned ? UZERO : ZERO;
          var approx, rem, res;
          if (!this.unsigned) {
            if (this.eq(MIN_VALUE)) {
              if (divisor.eq(ONE) || divisor.eq(NEG_ONE))
                return MIN_VALUE;
              else if (divisor.eq(MIN_VALUE)) return ONE;
              else {
                var halfThis = this.shr(1);
                approx = halfThis.div(divisor).shl(1);
                if (approx.eq(ZERO)) {
                  return divisor.isNegative() ? ONE : NEG_ONE;
                } else {
                  rem = this.sub(divisor.mul(approx));
                  res = approx.add(rem.div(divisor));
                  return res;
                }
              }
            } else if (divisor.eq(MIN_VALUE)) return this.unsigned ? UZERO : ZERO;
            if (this.isNegative()) {
              if (divisor.isNegative()) return this.neg().div(divisor.neg());
              return this.neg().div(divisor).neg();
            } else if (divisor.isNegative()) return this.div(divisor.neg()).neg();
            res = ZERO;
          } else {
            if (!divisor.unsigned) divisor = divisor.toUnsigned();
            if (divisor.gt(this)) return UZERO;
            if (divisor.gt(this.shru(1)))
              return UONE;
            res = UZERO;
          }
          rem = this;
          while (rem.gte(divisor)) {
            approx = Math.max(1, Math.floor(rem.toNumber() / divisor.toNumber()));
            var log2 = Math.ceil(Math.log(approx) / Math.LN2), delta = log2 <= 48 ? 1 : pow_dbl(2, log2 - 48), approxRes = fromNumber(approx), approxRem = approxRes.mul(divisor);
            while (approxRem.isNegative() || approxRem.gt(rem)) {
              approx -= delta;
              approxRes = fromNumber(approx, this.unsigned);
              approxRem = approxRes.mul(divisor);
            }
            if (approxRes.isZero()) approxRes = ONE;
            res = res.add(approxRes);
            rem = rem.sub(approxRem);
          }
          return res;
        };
        LongPrototype.div = LongPrototype.divide;
        LongPrototype.modulo = function modulo(divisor) {
          if (!isLong(divisor)) divisor = fromValue(divisor);
          if (wasm) {
            var low = (this.unsigned ? wasm["rem_u"] : wasm["rem_s"])(
              this.low,
              this.high,
              divisor.low,
              divisor.high
            );
            return fromBits(low, wasm["get_high"](), this.unsigned);
          }
          return this.sub(this.div(divisor).mul(divisor));
        };
        LongPrototype.mod = LongPrototype.modulo;
        LongPrototype.rem = LongPrototype.modulo;
        LongPrototype.not = function not() {
          return fromBits(~this.low, ~this.high, this.unsigned);
        };
        LongPrototype.countLeadingZeros = function countLeadingZeros() {
          return this.high ? Math.clz32(this.high) : Math.clz32(this.low) + 32;
        };
        LongPrototype.clz = LongPrototype.countLeadingZeros;
        LongPrototype.countTrailingZeros = function countTrailingZeros() {
          return this.low ? ctz32(this.low) : ctz32(this.high) + 32;
        };
        LongPrototype.ctz = LongPrototype.countTrailingZeros;
        LongPrototype.and = function and(other) {
          if (!isLong(other)) other = fromValue(other);
          return fromBits(
            this.low & other.low,
            this.high & other.high,
            this.unsigned
          );
        };
        LongPrototype.or = function or(other) {
          if (!isLong(other)) other = fromValue(other);
          return fromBits(
            this.low | other.low,
            this.high | other.high,
            this.unsigned
          );
        };
        LongPrototype.xor = function xor(other) {
          if (!isLong(other)) other = fromValue(other);
          return fromBits(
            this.low ^ other.low,
            this.high ^ other.high,
            this.unsigned
          );
        };
        LongPrototype.shiftLeft = function shiftLeft(numBits) {
          if (isLong(numBits)) numBits = numBits.toInt();
          if ((numBits &= 63) === 0) return this;
          else if (numBits < 32)
            return fromBits(
              this.low << numBits,
              this.high << numBits | this.low >>> 32 - numBits,
              this.unsigned
            );
          else return fromBits(0, this.low << numBits - 32, this.unsigned);
        };
        LongPrototype.shl = LongPrototype.shiftLeft;
        LongPrototype.shiftRight = function shiftRight(numBits) {
          if (isLong(numBits)) numBits = numBits.toInt();
          if ((numBits &= 63) === 0) return this;
          else if (numBits < 32)
            return fromBits(
              this.low >>> numBits | this.high << 32 - numBits,
              this.high >> numBits,
              this.unsigned
            );
          else
            return fromBits(
              this.high >> numBits - 32,
              this.high >= 0 ? 0 : -1,
              this.unsigned
            );
        };
        LongPrototype.shr = LongPrototype.shiftRight;
        LongPrototype.shiftRightUnsigned = function shiftRightUnsigned(numBits) {
          if (isLong(numBits)) numBits = numBits.toInt();
          if ((numBits &= 63) === 0) return this;
          if (numBits < 32)
            return fromBits(
              this.low >>> numBits | this.high << 32 - numBits,
              this.high >>> numBits,
              this.unsigned
            );
          if (numBits === 32) return fromBits(this.high, 0, this.unsigned);
          return fromBits(this.high >>> numBits - 32, 0, this.unsigned);
        };
        LongPrototype.shru = LongPrototype.shiftRightUnsigned;
        LongPrototype.shr_u = LongPrototype.shiftRightUnsigned;
        LongPrototype.rotateLeft = function rotateLeft(numBits) {
          var b;
          if (isLong(numBits)) numBits = numBits.toInt();
          if ((numBits &= 63) === 0) return this;
          if (numBits === 32) return fromBits(this.high, this.low, this.unsigned);
          if (numBits < 32) {
            b = 32 - numBits;
            return fromBits(
              this.low << numBits | this.high >>> b,
              this.high << numBits | this.low >>> b,
              this.unsigned
            );
          }
          numBits -= 32;
          b = 32 - numBits;
          return fromBits(
            this.high << numBits | this.low >>> b,
            this.low << numBits | this.high >>> b,
            this.unsigned
          );
        };
        LongPrototype.rotl = LongPrototype.rotateLeft;
        LongPrototype.rotateRight = function rotateRight(numBits) {
          var b;
          if (isLong(numBits)) numBits = numBits.toInt();
          if ((numBits &= 63) === 0) return this;
          if (numBits === 32) return fromBits(this.high, this.low, this.unsigned);
          if (numBits < 32) {
            b = 32 - numBits;
            return fromBits(
              this.high << b | this.low >>> numBits,
              this.low << b | this.high >>> numBits,
              this.unsigned
            );
          }
          numBits -= 32;
          b = 32 - numBits;
          return fromBits(
            this.low << b | this.high >>> numBits,
            this.high << b | this.low >>> numBits,
            this.unsigned
          );
        };
        LongPrototype.rotr = LongPrototype.rotateRight;
        LongPrototype.toSigned = function toSigned() {
          if (!this.unsigned) return this;
          return fromBits(this.low, this.high, false);
        };
        LongPrototype.toUnsigned = function toUnsigned() {
          if (this.unsigned) return this;
          return fromBits(this.low, this.high, true);
        };
        LongPrototype.toBytes = function toBytes(le) {
          return le ? this.toBytesLE() : this.toBytesBE();
        };
        LongPrototype.toBytesLE = function toBytesLE() {
          var hi = this.high, lo = this.low;
          return [
            lo & 255,
            lo >>> 8 & 255,
            lo >>> 16 & 255,
            lo >>> 24,
            hi & 255,
            hi >>> 8 & 255,
            hi >>> 16 & 255,
            hi >>> 24
          ];
        };
        LongPrototype.toBytesBE = function toBytesBE() {
          var hi = this.high, lo = this.low;
          return [
            hi >>> 24,
            hi >>> 16 & 255,
            hi >>> 8 & 255,
            hi & 255,
            lo >>> 24,
            lo >>> 16 & 255,
            lo >>> 8 & 255,
            lo & 255
          ];
        };
        Long.fromBytes = function fromBytes(bytes, unsigned, le) {
          return le ? Long.fromBytesLE(bytes, unsigned) : Long.fromBytesBE(bytes, unsigned);
        };
        Long.fromBytesLE = function fromBytesLE(bytes, unsigned) {
          return new Long(
            bytes[0] | bytes[1] << 8 | bytes[2] << 16 | bytes[3] << 24,
            bytes[4] | bytes[5] << 8 | bytes[6] << 16 | bytes[7] << 24,
            unsigned
          );
        };
        Long.fromBytesBE = function fromBytesBE(bytes, unsigned) {
          return new Long(
            bytes[4] << 24 | bytes[5] << 16 | bytes[6] << 8 | bytes[7],
            bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3],
            unsigned
          );
        };
        if (typeof BigInt === "function") {
          Long.fromBigInt = function fromBigInt(value, unsigned) {
            var lowBits = Number(BigInt.asIntN(32, value));
            var highBits = Number(BigInt.asIntN(32, value >> BigInt(32)));
            return fromBits(lowBits, highBits, unsigned);
          };
          Long.fromValue = function fromValueWithBigInt(value, unsigned) {
            if (typeof value === "bigint") return Long.fromBigInt(value, unsigned);
            return fromValue(value, unsigned);
          };
          LongPrototype.toBigInt = function toBigInt() {
            var lowBigInt = BigInt(this.low >>> 0);
            var highBigInt = BigInt(this.unsigned ? this.high >>> 0 : this.high);
            return highBigInt << BigInt(32) | lowBigInt;
          };
        }
        var _default = _exports.default = Long;
      }
    );
  }
});

// ../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/serialize.js
var require_serialize = __commonJS({
  "../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/serialize.js"(exports2) {
    var Long = require_umd();
    function align(n) {
      return n + 3 & ~3;
    }
    var MAX_STRING_SIZE = 255;
    var BlrWriter = class {
      constructor(size) {
        this.buffer = Buffer.alloc(size || 32);
        this.pos = 0;
      }
      ensure(len) {
        var newlen = this.buffer.length;
        while (newlen < this.pos + len)
          newlen *= 2;
        if (this.buffer.length >= newlen)
          return;
        var b = Buffer.alloc(newlen);
        this.buffer.copy(b);
        delete this.buffer;
        this.buffer = b;
      }
      addByte(b) {
        this.ensure(1);
        this.buffer.writeUInt8(b, this.pos);
        this.pos++;
      }
      addShort(b) {
        this.ensure(1);
        this.buffer.writeInt8(b, this.pos);
        this.pos++;
      }
      addSmall(b) {
        this.ensure(2);
        this.buffer.writeInt16LE(b, this.pos);
        this.pos += 2;
      }
      addWord(b) {
        this.ensure(2);
        this.buffer.writeUInt16LE(b, this.pos);
        this.pos += 2;
      }
      addInt32(b) {
        this.ensure(4);
        this.buffer.writeUInt32LE(b, this.pos);
        this.pos += 4;
      }
      addByteInt32(c, b) {
        this.addByte(c);
        this.ensure(4);
        this.buffer.writeUInt32LE(b, this.pos);
        this.pos += 4;
      }
      addNumeric(c, v) {
        if (v < 256) {
          this.ensure(3);
          this.buffer.writeUInt8(c, this.pos);
          this.pos++;
          this.buffer.writeUInt8(1, this.pos);
          this.pos++;
          this.buffer.writeUInt8(v, this.pos);
          this.pos++;
          return;
        }
        this.ensure(6);
        this.buffer.writeUInt8(c, this.pos);
        this.pos++;
        this.buffer.writeUInt8(4, this.pos);
        this.pos++;
        this.buffer.writeInt32BE(v, this.pos);
        this.pos += 4;
      }
      addBytes(b) {
        this.ensure(b.length);
        for (var i = 0, length = b.length; i < length; i++) {
          this.buffer.writeUInt8(b[i], this.pos);
          this.pos++;
        }
      }
      addString(c, s, encoding) {
        this.addByte(c);
        var len = Buffer.byteLength(s, encoding);
        if (len > MAX_STRING_SIZE)
          throw new Error("blr string is too big");
        this.ensure(len + 1);
        this.buffer.writeUInt8(len, this.pos);
        this.pos++;
        this.buffer.write(s, this.pos, len, encoding);
        this.pos += len;
      }
      addBuffer(b) {
        this.addWord(b.length);
        this.ensure(b.length);
        b.copy(this.buffer, this.pos);
        this.pos += b.length;
      }
      addString2(c, s, encoding) {
        this.addByte(c);
        var len = Buffer.byteLength(s, encoding);
        if (len > MAX_STRING_SIZE * MAX_STRING_SIZE)
          throw new Error("blr string is too big");
        this.ensure(len + 2);
        this.buffer.writeUInt16LE(len, this.pos);
        this.pos += 2;
        this.buffer.write(s, this.pos, len, encoding);
        this.pos += len;
      }
      addMultiblockPart(c, s, encoding) {
        var buff = Buffer.from(s, encoding);
        var remaining = buff.length;
        var step = 0;
        while (remaining > 0) {
          var toWrite = Math.min(remaining, 254);
          this.addByte(c);
          this.addByte(toWrite + 1);
          this.addByte(step);
          this.ensure(toWrite);
          buff.copy(this.buffer, this.pos, step * 254, step * 254 + toWrite);
          step++;
          remaining -= toWrite;
          this.pos += toWrite;
        }
      }
    };
    var BlrReader = class {
      constructor(buffer) {
        this.buffer = buffer;
        this.pos = 0;
      }
      readByteCode() {
        return this.buffer.readUInt8(this.pos++);
      }
      readInt32() {
        var value = this.buffer.readUInt32LE(this.pos);
        this.pos += 4;
        return value;
      }
      readInt() {
        var len = this.buffer.readUInt16LE(this.pos);
        this.pos += 2;
        var value;
        switch (len) {
          case 1:
            value = this.buffer.readInt8(this.pos);
            break;
          case 2:
            value = this.buffer.readInt16LE(this.pos);
            break;
          case 4:
            value = this.buffer.readInt32LE(this.pos);
        }
        this.pos += len;
        return value;
      }
      readString(encoding) {
        var len = this.buffer.readUInt16LE(this.pos);
        var str;
        this.pos += 2;
        if (len <= 0)
          return "";
        str = this.buffer.toString(encoding, this.pos, this.pos + len);
        this.pos += len;
        return str;
      }
      readSegment() {
        var ret, tmp;
        var len = this.buffer.readUInt16LE(this.pos);
        this.pos += 2;
        while (len > 0) {
          if (ret) {
            tmp = ret;
            ret = Buffer.alloc(tmp.length + len);
            tmp.copy(ret);
            this.buffer.copy(ret, tmp.length, this.pos, this.pos + len);
          } else {
            ret = Buffer.alloc(len);
            this.buffer.copy(ret, 0, this.pos, this.pos + len);
          }
          this.pos += len;
          if (this.pos === this.buffer.length)
            break;
          len = this.buffer.readUInt16LE(this.pos);
          this.pos += 2;
        }
        return ret ? ret : Buffer.alloc(0);
      }
    };
    var XdrWriter = class {
      constructor(size) {
        this.buffer = Buffer.alloc(size || 32);
        this.pos = 0;
      }
      ensure(len) {
        var newlen = this.buffer.length;
        while (newlen < this.pos + len)
          newlen *= 2;
        if (this.buffer.length >= newlen)
          return;
        var b = Buffer.alloc(newlen);
        this.buffer.copy(b);
        delete this.buffer;
        this.buffer = b;
      }
      addInt(value) {
        this.ensure(4);
        this.buffer.writeInt32BE(value, this.pos);
        this.pos += 4;
      }
      addInt64(value) {
        this.ensure(8);
        var l = Long.fromNumber(value);
        this.buffer.writeInt32BE(l.high, this.pos);
        this.pos += 4;
        this.buffer.writeInt32BE(l.low, this.pos);
        this.pos += 4;
      }
      addInt128(value) {
        this.ensure(16);
        const bigValue = BigInt(value);
        const high = bigValue >> BigInt(64);
        const low = bigValue & BigInt("0xFFFFFFFFFFFFFFFF");
        this.buffer.writeBigUInt64BE(high, this.pos);
        this.pos += 8;
        this.buffer.writeBigUInt64BE(low, this.pos);
        this.pos += 8;
      }
      addUInt(value) {
        this.ensure(4);
        this.buffer.writeUInt32BE(value, this.pos);
        this.pos += 4;
      }
      addString(s, encoding) {
        var len = Buffer.byteLength(s, encoding);
        var alen = align(len);
        this.ensure(alen + 4);
        this.buffer.writeInt32BE(len, this.pos);
        this.pos += 4;
        this.buffer.write(s, this.pos, len, encoding);
        this.pos += alen;
      }
      addText(s, encoding) {
        var len = Buffer.byteLength(s, encoding);
        var alen = align(len);
        this.ensure(alen);
        this.buffer.write(s, this.pos, len, encoding);
        this.pos += alen;
      }
      addBlr(blr) {
        var alen = align(blr.pos);
        this.ensure(alen + 4);
        this.buffer.writeInt32BE(blr.pos, this.pos);
        this.pos += 4;
        blr.buffer.copy(this.buffer, this.pos);
        this.pos += alen;
      }
      getData() {
        return this.buffer.slice(0, this.pos);
      }
      addDouble(value) {
        this.ensure(8);
        this.buffer.writeDoubleBE(value, this.pos);
        this.pos += 8;
      }
      addQuad(quad) {
        this.ensure(8);
        var b = this.buffer;
        b.writeInt32BE(quad.high, this.pos);
        this.pos += 4;
        b.writeInt32BE(quad.low, this.pos);
        this.pos += 4;
      }
      addBuffer(buffer) {
        this.ensure(buffer.length);
        buffer.copy(this.buffer, this.pos, 0, buffer.length);
        this.pos += buffer.length;
      }
      addAlignment(len) {
        var alen = 4 - len & 3;
        this.ensure(alen);
        this.buffer.write("ffffff", this.pos, alen, "hex");
        this.pos += alen;
      }
    };
    var XdrReader = class {
      constructor(buffer) {
        this.buffer = buffer;
        this.pos = 0;
      }
      readInt() {
        var r = this.buffer.readInt32BE(this.pos);
        this.pos += 4;
        return r;
      }
      readUInt() {
        var r = this.buffer.readUInt32BE(this.pos);
        this.pos += 4;
        return r;
      }
      readInt64() {
        var high = this.buffer.readInt32BE(this.pos);
        this.pos += 4;
        var low = this.buffer.readInt32BE(this.pos);
        this.pos += 4;
        return new Long(low, high).toNumber();
      }
      readInt128() {
        var high = this.buffer.readBigUInt64BE(this.pos);
        this.pos += 8;
        var low = this.buffer.readBigUInt64BE(this.pos);
        this.pos += 8;
        return (BigInt(high) << BigInt(64)) + BigInt(low);
      }
      readShort() {
        var r = this.buffer.readInt16BE(this.pos);
        this.pos += 2;
        return r;
      }
      readQuad() {
        var b = this.buffer;
        var high = b.readInt32BE(this.pos);
        this.pos += 4;
        var low = b.readInt32BE(this.pos);
        this.pos += 4;
        return { low, high };
      }
      readFloat() {
        var r = this.buffer.readFloatBE(this.pos);
        this.pos += 4;
        return r;
      }
      readDouble() {
        var r = this.buffer.readDoubleBE(this.pos);
        this.pos += 8;
        return r;
      }
      readArray() {
        var len = this.readInt();
        if (!len)
          return;
        var r = this.buffer.slice(this.pos, this.pos + len);
        this.pos += align(len);
        return r;
      }
      readBuffer(len, toAlign = true) {
        if (!arguments.length) {
          len = this.readInt();
        }
        if (len !== null && len !== void 0) {
          if (len <= 0) {
            return Buffer.alloc(0);
          }
          var r = this.buffer.slice(this.pos, this.pos + len);
          this.pos += toAlign ? align(len) : len;
          return r;
        }
      }
      readString(encoding) {
        var len = this.readInt();
        return this.readText(len, encoding);
      }
      readText(len, encoding) {
        if (len <= 0)
          return "";
        var r = this.buffer.toString(encoding, this.pos, this.pos + len);
        this.pos += align(len);
        return r;
      }
    };
    var WORD_LOG = 5;
    var BUFFER_BITS = 8;
    var BIT_ON = 1;
    var BIT_OFF = 0;
    var BitSet = class {
      constructor(buffer) {
        this.data = [];
        if (buffer) {
          this.scale(buffer.length * BUFFER_BITS);
          for (var i = 0; i < buffer.length; i++) {
            var n = buffer[i];
            for (var j = 0; j < BUFFER_BITS; j++) {
              var k = i * BUFFER_BITS + j;
              this.data[k >>> WORD_LOG] |= (n >> j & BIT_ON) << k;
            }
          }
        }
      }
      scale(index) {
        var l = index >>> WORD_LOG;
        for (var i = this.data.length; l >= i; l--) {
          this.data.push(BIT_OFF);
        }
      }
      set(index, value) {
        let pos = index >>> 3;
        for (let i = this.data.length; pos >= i; pos--) {
          this.data.push(BIT_OFF);
        }
        pos = index >>> 3;
        if (value === void 0 || value) {
          this.data[pos] |= 1 << index % BUFFER_BITS;
        } else {
          this.data[pos] &= ~(1 << index % BUFFER_BITS);
        }
      }
      get(index) {
        var n = index >>> WORD_LOG;
        if (n >= this.data.length) {
          return BIT_OFF;
        }
        return this.data[n] >>> index & BIT_ON;
      }
      toBuffer() {
        return Buffer.from(this.data);
      }
    };
    exports2.BlrWriter = BlrWriter;
    exports2.BlrReader = BlrReader;
    exports2.XdrWriter = XdrWriter;
    exports2.XdrReader = XdrReader;
    exports2.BitSet = BitSet;
  }
});

// ../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/srp.js
var require_srp = __commonJS({
  "../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/srp.js"(exports2) {
    var BigInt2 = require_BigInteger();
    var crypto = require("crypto");
    var SRP_KEY_SIZE = 128;
    var SRP_KEY_MAX = BigInt2("340282366920938463463374607431768211456");
    var DEBUG = false;
    var DEBUG_PRIVATE_KEY = BigInt2("84316857F47914F838918D5C12CE3A3E7A9B2D7C9486346809E9EEFCE8DE7CD4259D8BE4FD0BCC2D259553769E078FA61EE2977025E4DA42F7FD97914D8A33723DFAFBC00770B7DA0C2E3778A05790F0C0F33C32A19ED88A12928567749021B3FD45DCD1CE259C45325067E3DDC972F87867349BA82C303CCCAA9B207218007B", 16);
    var PRIME = {
      N: BigInt2("E67D2E994B2F900C3F41F08F5BB2627ED0D49EE1FE767A52EFCD565CD6E768812C3E1E9CE8F0A8BEA6CB13CD29DDEBF7A96D4A93B55D488DF099A15C89DCB0640738EB2CBDD9A8F7BAB561AB1B0DC1C6CDABF303264A08D1BCA932D1F1EE428B619D970F342ABA9A65793B8B2F041AE5364350C16F735F56ECBCA87BD57B29E7", 16),
      g: BigInt2(2),
      k: BigInt2("1277432915985975349439481660349303019122249719989")
    };
    exports2.clientSeed = function(a = toBigInt(crypto.randomBytes(SRP_KEY_SIZE))) {
      var A = PRIME.g.modPow(a, PRIME.N);
      dump("a", a);
      dump("A", A);
      return {
        public: A,
        private: a
      };
    };
    exports2.serverSeed = function(user, password, salt, b = toBigInt(crypto.randomBytes(SRP_KEY_SIZE))) {
      var v = getVerifier(user, password, salt);
      var gb = PRIME.g.modPow(b, PRIME.N);
      var kv = PRIME.k.multiply(v).mod(PRIME.N);
      var B = kv.add(gb).mod(PRIME.N);
      dump("v", v);
      dump("b", b);
      dump("gb", b);
      dump("kv", v);
      dump("B", B);
      return {
        public: B,
        private: b
      };
    };
    exports2.serverSession = function(user, password, salt, A, B, b) {
      var u = getScramble(A, B);
      var v = getVerifier(user, password, salt);
      var vu = v.modPow(u, PRIME.N);
      var Avu = A.multiply(vu).mod(PRIME.N);
      var sessionSecret = Avu.modPow(b, PRIME.N);
      var K = getHash("sha1", toBuffer(sessionSecret));
      dump("server sessionSecret", sessionSecret);
      dump("server K", K);
      return BigInt2(K, 16);
    };
    exports2.clientProof = function(user, password, salt, A, B, a, hashAlgo) {
      var K = clientSession(user, password, salt, A, B, a);
      var n1, n2;
      n1 = toBigInt(getHash("sha1", toBuffer(PRIME.N)));
      n2 = toBigInt(getHash("sha1", toBuffer(PRIME.g)));
      dump("n1", n1);
      dump("n2", n2);
      n1 = n1.modPow(n2, PRIME.N);
      n2 = toBigInt(getHash("sha1", user));
      var M = toBigInt(getHash(hashAlgo, toBuffer(n1), toBuffer(n2), salt, toBuffer(A), toBuffer(B), toBuffer(K)));
      dump("n1-2", n1);
      dump("n2-2", n2);
      dump("proof:M", M);
      return {
        clientSessionKey: K,
        authData: M
      };
    };
    function hexPad(hex) {
      if (hex.length % 2 !== 0) {
        hex = "0" + hex;
      }
      return hex;
    }
    exports2.hexPad = hexPad;
    function pad(n) {
      var buff = Buffer.from(hexPad(n.toString(16)), "hex");
      if (buff.length > SRP_KEY_SIZE) {
        buff = buff.slice(buff.length - SRP_KEY_SIZE, buff.length);
      }
      return buff;
    }
    function getScramble(A, B) {
      return BigInt2(getHash("sha1", pad(A), pad(B)), 16);
    }
    function clientSession(user, password, salt, A, B, a) {
      var u = getScramble(A, B);
      var x = getUserHash(user, salt, password);
      var gx = PRIME.g.modPow(x, PRIME.N);
      var kgx = PRIME.k.multiply(gx).mod(PRIME.N);
      var diff = B.subtract(kgx).mod(PRIME.N);
      if (diff.lesser(0)) {
        diff = diff.add(PRIME.N);
      }
      var ux = u.multiply(x).mod(PRIME.N);
      var aux = a.add(ux).mod(PRIME.N);
      var sessionSecret = diff.modPow(aux, PRIME.N);
      var K = toBigInt(getHash("sha1", toBuffer(sessionSecret)));
      dump("B", B);
      dump("u", u);
      dump("x", x);
      dump("gx", gx);
      dump("kgx", kgx);
      dump("diff", diff);
      dump("ux", ux);
      dump("aux", aux);
      dump("sessionSecret", sessionSecret);
      dump("sessionKey(K)", K);
      return K;
    }
    function getUserHash(user, salt, password) {
      var hash1 = getHash("sha1", user.toUpperCase(), ":", password);
      var hash2 = getHash("sha1", salt, toBuffer(hash1));
      return toBigInt(hash2);
    }
    function getVerifier(user, password, salt) {
      return PRIME.g.modPow(getUserHash(user, salt, password), PRIME.N);
    }
    function getHash(algo, ...data) {
      var hash = crypto.createHash(algo);
      for (var d of data) {
        hash.update(d);
      }
      return hash.digest("hex");
    }
    function toBuffer(bigInt) {
      return Buffer.from(BigInt2.isInstance(bigInt) ? hexPad(bigInt.toString(16)) : bigInt, "hex");
    }
    function toBigInt(hex) {
      return BigInt2(Buffer.isBuffer(hex) ? hex.toString("hex") : hex, 16);
    }
    function dump(key, value) {
      if (DEBUG) {
        if (BigInt2.isInstance(value)) {
          value = value.toString(16);
        }
        console.log(key + "=" + value);
      }
    }
  }
});

// ../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/unix-crypt.js
var require_unix_crypt = __commonJS({
  "../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/unix-crypt.js"(exports2, module2) {
    var CON_SALT = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      14,
      15,
      16,
      17,
      18,
      19,
      20,
      21,
      22,
      23,
      24,
      25,
      26,
      27,
      28,
      29,
      30,
      31,
      32,
      33,
      34,
      35,
      36,
      37,
      32,
      33,
      34,
      35,
      36,
      37,
      38,
      39,
      40,
      41,
      42,
      43,
      44,
      45,
      46,
      47,
      48,
      49,
      50,
      51,
      52,
      53,
      54,
      55,
      56,
      57,
      58,
      59,
      60,
      61,
      62,
      63,
      0,
      0,
      0,
      0,
      0
    ];
    var COV2CHAR = [
      46,
      47,
      48,
      49,
      50,
      51,
      52,
      53,
      54,
      55,
      56,
      57,
      65,
      66,
      67,
      68,
      69,
      70,
      71,
      72,
      73,
      74,
      75,
      76,
      77,
      78,
      79,
      80,
      81,
      82,
      83,
      84,
      85,
      86,
      87,
      88,
      89,
      90,
      97,
      98,
      99,
      100,
      101,
      102,
      103,
      104,
      105,
      106,
      107,
      108,
      109,
      110,
      111,
      112,
      113,
      114,
      115,
      116,
      117,
      118,
      119,
      120,
      121,
      122
    ];
    var SHIFT2 = [false, false, true, true, true, true, true, true, false, true, true, true, true, true, true, false];
    var SKB = [
      [
        0,
        16,
        536870912,
        536870928,
        65536,
        65552,
        536936448,
        536936464,
        2048,
        2064,
        536872960,
        536872976,
        67584,
        67600,
        536938496,
        536938512,
        32,
        48,
        536870944,
        536870960,
        65568,
        65584,
        536936480,
        536936496,
        2080,
        2096,
        536872992,
        536873008,
        67616,
        67632,
        536938528,
        536938544,
        524288,
        524304,
        537395200,
        537395216,
        589824,
        589840,
        537460736,
        537460752,
        526336,
        526352,
        537397248,
        537397264,
        591872,
        591888,
        537462784,
        537462800,
        524320,
        524336,
        537395232,
        537395248,
        589856,
        589872,
        537460768,
        537460784,
        526368,
        526384,
        537397280,
        537397296,
        591904,
        591920,
        537462816,
        537462832
      ],
      [
        0,
        33554432,
        8192,
        33562624,
        2097152,
        35651584,
        2105344,
        35659776,
        4,
        33554436,
        8196,
        33562628,
        2097156,
        35651588,
        2105348,
        35659780,
        1024,
        33555456,
        9216,
        33563648,
        2098176,
        35652608,
        2106368,
        35660800,
        1028,
        33555460,
        9220,
        33563652,
        2098180,
        35652612,
        2106372,
        35660804,
        268435456,
        301989888,
        268443648,
        301998080,
        270532608,
        304087040,
        270540800,
        304095232,
        268435460,
        301989892,
        268443652,
        301998084,
        270532612,
        304087044,
        270540804,
        304095236,
        268436480,
        301990912,
        268444672,
        301999104,
        270533632,
        304088064,
        270541824,
        304096256,
        268436484,
        301990916,
        268444676,
        301999108,
        270533636,
        304088068,
        270541828,
        304096260
      ],
      [
        0,
        1,
        262144,
        262145,
        16777216,
        16777217,
        17039360,
        17039361,
        2,
        3,
        262146,
        262147,
        16777218,
        16777219,
        17039362,
        17039363,
        512,
        513,
        262656,
        262657,
        16777728,
        16777729,
        17039872,
        17039873,
        514,
        515,
        262658,
        262659,
        16777730,
        16777731,
        17039874,
        17039875,
        134217728,
        134217729,
        134479872,
        134479873,
        150994944,
        150994945,
        151257088,
        151257089,
        134217730,
        134217731,
        134479874,
        134479875,
        150994946,
        150994947,
        151257090,
        151257091,
        134218240,
        134218241,
        134480384,
        134480385,
        150995456,
        150995457,
        151257600,
        151257601,
        134218242,
        134218243,
        134480386,
        134480387,
        150995458,
        150995459,
        151257602,
        151257603
      ],
      [
        0,
        1048576,
        256,
        1048832,
        8,
        1048584,
        264,
        1048840,
        4096,
        1052672,
        4352,
        1052928,
        4104,
        1052680,
        4360,
        1052936,
        67108864,
        68157440,
        67109120,
        68157696,
        67108872,
        68157448,
        67109128,
        68157704,
        67112960,
        68161536,
        67113216,
        68161792,
        67112968,
        68161544,
        67113224,
        68161800,
        131072,
        1179648,
        131328,
        1179904,
        131080,
        1179656,
        131336,
        1179912,
        135168,
        1183744,
        135424,
        1184e3,
        135176,
        1183752,
        135432,
        1184008,
        67239936,
        68288512,
        67240192,
        68288768,
        67239944,
        68288520,
        67240200,
        68288776,
        67244032,
        68292608,
        67244288,
        68292864,
        67244040,
        68292616,
        67244296,
        68292872
      ],
      [
        0,
        268435456,
        65536,
        268500992,
        4,
        268435460,
        65540,
        268500996,
        536870912,
        805306368,
        536936448,
        805371904,
        536870916,
        805306372,
        536936452,
        805371908,
        1048576,
        269484032,
        1114112,
        269549568,
        1048580,
        269484036,
        1114116,
        269549572,
        537919488,
        806354944,
        537985024,
        806420480,
        537919492,
        806354948,
        537985028,
        806420484,
        4096,
        268439552,
        69632,
        268505088,
        4100,
        268439556,
        69636,
        268505092,
        536875008,
        805310464,
        536940544,
        805376e3,
        536875012,
        805310468,
        536940548,
        805376004,
        1052672,
        269488128,
        1118208,
        269553664,
        1052676,
        269488132,
        1118212,
        269553668,
        537923584,
        806359040,
        537989120,
        806424576,
        537923588,
        806359044,
        537989124,
        806424580
      ],
      [
        0,
        134217728,
        8,
        134217736,
        1024,
        134218752,
        1032,
        134218760,
        131072,
        134348800,
        131080,
        134348808,
        132096,
        134349824,
        132104,
        134349832,
        1,
        134217729,
        9,
        134217737,
        1025,
        134218753,
        1033,
        134218761,
        131073,
        134348801,
        131081,
        134348809,
        132097,
        134349825,
        132105,
        134349833,
        33554432,
        167772160,
        33554440,
        167772168,
        33555456,
        167773184,
        33555464,
        167773192,
        33685504,
        167903232,
        33685512,
        167903240,
        33686528,
        167904256,
        33686536,
        167904264,
        33554433,
        167772161,
        33554441,
        167772169,
        33555457,
        167773185,
        33555465,
        167773193,
        33685505,
        167903233,
        33685513,
        167903241,
        33686529,
        167904257,
        33686537,
        167904265
      ],
      [
        0,
        256,
        524288,
        524544,
        16777216,
        16777472,
        17301504,
        17301760,
        16,
        272,
        524304,
        524560,
        16777232,
        16777488,
        17301520,
        17301776,
        2097152,
        2097408,
        2621440,
        2621696,
        18874368,
        18874624,
        19398656,
        19398912,
        2097168,
        2097424,
        2621456,
        2621712,
        18874384,
        18874640,
        19398672,
        19398928,
        512,
        768,
        524800,
        525056,
        16777728,
        16777984,
        17302016,
        17302272,
        528,
        784,
        524816,
        525072,
        16777744,
        16778e3,
        17302032,
        17302288,
        2097664,
        2097920,
        2621952,
        2622208,
        18874880,
        18875136,
        19399168,
        19399424,
        2097680,
        2097936,
        2621968,
        2622224,
        18874896,
        18875152,
        19399184,
        19399440
      ],
      [
        0,
        67108864,
        262144,
        67371008,
        2,
        67108866,
        262146,
        67371010,
        8192,
        67117056,
        270336,
        67379200,
        8194,
        67117058,
        270338,
        67379202,
        32,
        67108896,
        262176,
        67371040,
        34,
        67108898,
        262178,
        67371042,
        8224,
        67117088,
        270368,
        67379232,
        8226,
        67117090,
        270370,
        67379234,
        2048,
        67110912,
        264192,
        67373056,
        2050,
        67110914,
        264194,
        67373058,
        10240,
        67119104,
        272384,
        67381248,
        10242,
        67119106,
        272386,
        67381250,
        2080,
        67110944,
        264224,
        67373088,
        2082,
        67110946,
        264226,
        67373090,
        10272,
        67119136,
        272416,
        67381280,
        10274,
        67119138,
        272418,
        67381282
      ]
    ];
    var SPTRANS = [
      [
        8520192,
        131072,
        2155872256,
        2156003840,
        8388608,
        2147615232,
        2147614720,
        2155872256,
        2147615232,
        8520192,
        8519680,
        2147484160,
        2155872768,
        8388608,
        0,
        2147614720,
        131072,
        2147483648,
        8389120,
        131584,
        2156003840,
        8519680,
        2147484160,
        8389120,
        2147483648,
        512,
        131584,
        2156003328,
        512,
        2155872768,
        2156003328,
        0,
        0,
        2156003840,
        8389120,
        2147614720,
        8520192,
        131072,
        2147484160,
        8389120,
        2156003328,
        512,
        131584,
        2155872256,
        2147615232,
        2147483648,
        2155872256,
        8519680,
        2156003840,
        131584,
        8519680,
        2155872768,
        8388608,
        2147484160,
        2147614720,
        0,
        131072,
        8388608,
        2155872768,
        8520192,
        2147483648,
        2156003328,
        512,
        2147615232
      ],
      [
        268705796,
        0,
        270336,
        268697600,
        268435460,
        8196,
        268443648,
        270336,
        8192,
        268697604,
        4,
        268443648,
        262148,
        268705792,
        268697600,
        4,
        262144,
        268443652,
        268697604,
        8192,
        270340,
        268435456,
        0,
        262148,
        268443652,
        270340,
        268705792,
        268435460,
        268435456,
        262144,
        8196,
        268705796,
        262148,
        268705792,
        268443648,
        270340,
        268705796,
        262148,
        268435460,
        0,
        268435456,
        8196,
        262144,
        268697604,
        8192,
        268435456,
        270340,
        268443652,
        268705792,
        8192,
        0,
        268435460,
        4,
        268705796,
        270336,
        268697600,
        268697604,
        262144,
        8196,
        268443648,
        268443652,
        4,
        268697600,
        270336
      ],
      [
        1090519040,
        16842816,
        64,
        1090519104,
        1073807360,
        16777216,
        1090519104,
        65600,
        16777280,
        65536,
        16842752,
        1073741824,
        1090584640,
        1073741888,
        1073741824,
        1090584576,
        0,
        1073807360,
        16842816,
        64,
        1073741888,
        1090584640,
        65536,
        1090519040,
        1090584576,
        16777280,
        1073807424,
        16842752,
        65600,
        0,
        16777216,
        1073807424,
        16842816,
        64,
        1073741824,
        65536,
        1073741888,
        1073807360,
        16842752,
        1090519104,
        0,
        16842816,
        65600,
        1090584576,
        1073807360,
        16777216,
        1090584640,
        1073741824,
        1073807424,
        1090519040,
        16777216,
        1090584640,
        65536,
        16777280,
        1090519104,
        65600,
        16777280,
        0,
        1090584576,
        1073741888,
        1090519040,
        1073807424,
        64,
        16842752
      ],
      [
        1049602,
        67109888,
        2,
        68158466,
        0,
        68157440,
        67109890,
        1048578,
        68158464,
        67108866,
        67108864,
        1026,
        67108866,
        1049602,
        1048576,
        67108864,
        68157442,
        1049600,
        1024,
        2,
        1049600,
        67109890,
        68157440,
        1024,
        1026,
        0,
        1048578,
        68158464,
        67109888,
        68157442,
        68158466,
        1048576,
        68157442,
        1026,
        1048576,
        67108866,
        1049600,
        67109888,
        2,
        68157440,
        67109890,
        0,
        1024,
        1048578,
        0,
        68157442,
        68158464,
        1024,
        67108864,
        68158466,
        1049602,
        1048576,
        68158466,
        2,
        67109888,
        1049602,
        1048578,
        1049600,
        68157440,
        67109890,
        1026,
        67108864,
        67108866,
        68158464
      ],
      [
        33554432,
        16384,
        256,
        33571080,
        33570824,
        33554688,
        16648,
        33570816,
        16384,
        8,
        33554440,
        16640,
        33554696,
        33570824,
        33571072,
        0,
        16640,
        33554432,
        16392,
        264,
        33554688,
        16648,
        0,
        33554440,
        8,
        33554696,
        33571080,
        16392,
        33570816,
        256,
        264,
        33571072,
        33571072,
        33554696,
        16392,
        33570816,
        16384,
        8,
        33554440,
        33554688,
        33554432,
        16640,
        33571080,
        0,
        16648,
        33554432,
        256,
        16392,
        33554696,
        256,
        0,
        33571080,
        33570824,
        33571072,
        264,
        16384,
        16640,
        33570824,
        33554688,
        264,
        8,
        16648,
        33570816,
        33554440
      ],
      [
        536870928,
        524304,
        0,
        537397248,
        524304,
        2048,
        536872976,
        524288,
        2064,
        537397264,
        526336,
        536870912,
        536872960,
        536870928,
        537395200,
        526352,
        524288,
        536872976,
        537395216,
        0,
        2048,
        16,
        537397248,
        537395216,
        537397264,
        537395200,
        536870912,
        2064,
        16,
        526336,
        526352,
        536872960,
        2064,
        536870912,
        536872960,
        526352,
        537397248,
        524304,
        0,
        536872960,
        536870912,
        2048,
        537395216,
        524288,
        524304,
        537397264,
        526336,
        16,
        537397264,
        526336,
        524288,
        536872976,
        536870928,
        537395200,
        526352,
        0,
        2048,
        536870928,
        536872976,
        537397248,
        537395200,
        2064,
        16,
        537395216
      ],
      [
        4096,
        128,
        4194432,
        4194305,
        4198529,
        4097,
        4224,
        0,
        4194304,
        4194433,
        129,
        4198400,
        1,
        4198528,
        4198400,
        129,
        4194433,
        4096,
        4097,
        4198529,
        0,
        4194432,
        4194305,
        4224,
        4198401,
        4225,
        4198528,
        1,
        4225,
        4198401,
        128,
        4194304,
        4225,
        4198400,
        4198401,
        129,
        4096,
        128,
        4194304,
        4198401,
        4194433,
        4225,
        4224,
        0,
        128,
        4194305,
        1,
        4194432,
        0,
        4194433,
        4194432,
        4224,
        129,
        4096,
        4198529,
        4194304,
        4198528,
        1,
        4097,
        4198529,
        4194305,
        4198528,
        4198400,
        4097
      ],
      [
        136314912,
        136347648,
        32800,
        0,
        134250496,
        2097184,
        136314880,
        136347680,
        32,
        134217728,
        2129920,
        32800,
        2129952,
        134250528,
        134217760,
        136314880,
        32768,
        2129952,
        2097184,
        134250496,
        136347680,
        134217760,
        0,
        2129920,
        134217728,
        2097152,
        134250528,
        136314912,
        2097152,
        32768,
        136347648,
        32,
        2097152,
        32768,
        134217760,
        136347680,
        32800,
        134217728,
        0,
        2129920,
        136314912,
        134250528,
        134250496,
        2097184,
        136347648,
        32,
        2097184,
        134250496,
        136347680,
        2097152,
        136314880,
        134217760,
        2129920,
        32800,
        134250528,
        136314880,
        32,
        136347648,
        2129952,
        0,
        134217728,
        136314912,
        32768,
        2129952
      ]
    ];
    function hPermOp(a, n, m) {
      var t = (a << 16 - n ^ a) & m;
      a = a ^ t ^ t >>> 16 - n;
      return a;
    }
    function intToFourBytes(iValue, b, offset) {
      b[offset++] = iValue & 255;
      b[offset++] = iValue >>> 8 & 255;
      b[offset++] = iValue >>> 16 & 255;
      b[offset++] = iValue >>> 24 & 255;
    }
    function byteToUnsigned(b) {
      var value = b;
      return value < 0 ? value + 256 : value;
    }
    function fourBytesToInt(b, offset) {
      var value = byteToUnsigned(b[offset++]);
      value |= byteToUnsigned(b[offset++]) << 8;
      value |= byteToUnsigned(b[offset++]) << 16;
      value |= byteToUnsigned(b[offset++]) << 24;
      return value;
    }
    function permOp(a, b, n, m, results) {
      var t = (a >>> n ^ b) & m;
      a ^= t << n;
      b ^= t;
      results[0] = a;
      results[1] = b;
    }
    function desSetKey(key) {
      var schedule = [];
      var c = fourBytesToInt(key, 0);
      var d = fourBytesToInt(key, 4);
      var results = [0, 0];
      permOp(d, c, 4, 252645135, results);
      d = results[0];
      c = results[1];
      c = hPermOp(c, -2, 3435921408);
      d = hPermOp(d, -2, 3435921408);
      permOp(d, c, 1, 1431655765, results);
      d = results[0];
      c = results[1];
      permOp(c, d, 8, 16711935, results);
      c = results[0];
      d = results[1];
      permOp(d, c, 1, 1431655765, results);
      d = results[0];
      c = results[1];
      d = (d & 255) << 16 | d & 65280 | (d & 16711680) >>> 16 | (c & 4026531840) >>> 4;
      c &= 268435455;
      var j = 0;
      for (var i = 0; i < 16; i++) {
        if (SHIFT2[i]) {
          c = c >>> 2 | c << 26;
          d = d >>> 2 | d << 26;
        } else {
          c = c >>> 1 | c << 27;
          d = d >>> 1 | d << 27;
        }
        c &= 268435455;
        d &= 268435455;
        var s = SKB[0][c & 63] | SKB[1][c >>> 6 & 3 | c >>> 7 & 60] | SKB[2][c >>> 13 & 15 | c >>> 14 & 48] | SKB[3][c >>> 20 & 1 | c >>> 21 & 6 | c >>> 22 & 56];
        var t = SKB[4][d & 63] | SKB[5][d >>> 7 & 3 | d >>> 8 & 60] | SKB[6][d >>> 15 & 63] | SKB[7][d >>> 21 & 15 | d >>> 22 & 48];
        schedule[j++] = t << 16 | s & 65535;
        s = s >>> 16 | t & 4294901760;
        s = s << 4 | s >>> 28;
        schedule[j++] = s;
      }
      return schedule;
    }
    function dEncrypt(el, r, s, e0, e1, sArr) {
      var v = r ^ r >>> 16;
      var u = v & e0;
      v &= e1;
      u = u ^ u << 16 ^ r ^ sArr[s];
      var t = v ^ v << 16 ^ r ^ sArr[s + 1];
      t = t >>> 4 | t << 28;
      el ^= SPTRANS[1][t & 63] | SPTRANS[3][t >>> 8 & 63] | SPTRANS[5][t >>> 16 & 63] | SPTRANS[7][t >>> 24 & 63] | SPTRANS[0][u & 63] | SPTRANS[2][u >>> 8 & 63] | SPTRANS[4][u >>> 16 & 63] | SPTRANS[6][u >>> 24 & 63];
      return el;
    }
    function body(schedule, eSwap0, eSwap1) {
      var left = 0;
      var right = 0;
      var t = 0;
      for (var j = 0; j < 25; j++) {
        for (var i = 0; i < 32; i += 4) {
          left = dEncrypt(left, right, i, eSwap0, eSwap1, schedule);
          right = dEncrypt(right, left, i + 2, eSwap0, eSwap1, schedule);
        }
        t = left;
        left = right;
        right = t;
      }
      t = right;
      right = left >>> 1 | left << 31;
      left = t >>> 1 | t << 31;
      var results = [0, 0];
      permOp(right, left, 1, 1431655765, results);
      right = results[0];
      left = results[1];
      permOp(left, right, 8, 16711935, results);
      left = results[0];
      right = results[1];
      permOp(right, left, 2, 858993459, results);
      right = results[0];
      left = results[1];
      permOp(left, right, 16, 65535, results);
      left = results[0];
      right = results[1];
      permOp(right, left, 4, 252645135, results);
      right = results[0];
      left = results[1];
      var out = [0, 0];
      out[0] = left;
      out[1] = right;
      return out;
    }
    function crypt(original, salt) {
      if (!(original instanceof Buffer)) {
        original = Buffer.from(original);
      }
      if (!salt) {
        throw new Error("Invalid salt value: " + salt);
      }
      var buffer = Buffer.alloc(13);
      var charZero = salt[0].charCodeAt();
      var charOne = salt[1].charCodeAt();
      buffer[0] = charZero;
      buffer[1] = charOne;
      var eSwap0 = CON_SALT[charZero];
      var eSwap1 = CON_SALT[charOne] << 4;
      var key = Buffer.alloc(8);
      for (var i = 0; i < key.length && i < original.length; i++) {
        var iChar = original[i];
        key[i] = iChar << 1;
      }
      var schedule = desSetKey(key);
      var out = body(schedule, eSwap0, eSwap1);
      var b = Buffer.alloc(9);
      intToFourBytes(out[0], b, 0);
      intToFourBytes(out[1], b, 4);
      b[8] = 0;
      var i = 2;
      var y = 0;
      var u = 128;
      for (; i < 13; i++) {
        var j = 0;
        var c = 0;
        for (; j < 6; j++) {
          c <<= 1;
          if ((b[y] & u) != 0) {
            c |= 1;
          }
          u >>>= 1;
          if (u == 0) {
            y++;
            u = 128;
          }
          buffer[i] = COV2CHAR[c];
        }
      }
      return buffer.toString("ascii");
    }
    module2.exports = {
      crypt
    };
  }
});

// ../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/xsqlvar.js
var require_xsqlvar = __commonJS({
  "../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/xsqlvar.js"(exports2, module2) {
    var Const = require_const();
    var ScaleDivisor = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15];
    var DateOffset = 40587;
    var TimeCoeff = 864e5;
    var MsPerMinute = 6e4;
    var SQLVarText = class {
      decode(data, lowerV13) {
        let ret;
        if (this.subType > 1) {
          ret = data.readText(this.length, Const.DEFAULT_ENCODING);
        } else if (this.subType === 0) {
          ret = data.readText(this.length, Const.DEFAULT_ENCODING);
        } else {
          ret = data.readBuffer(this.length);
        }
        if (!lowerV13 || !data.readInt()) {
          return ret;
        }
        return null;
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_text);
        blr.addWord(this.length);
      }
    };
    var SQLVarNull = class extends SQLVarText {
    };
    var SQLVarString = class {
      decode(data, lowerV13) {
        let ret;
        if (this.subType > 1) {
          ret = data.readString(Const.DEFAULT_ENCODING);
        } else if (this.subType === 0) {
          ret = data.readString(Const.DEFAULT_ENCODING);
        } else {
          ret = data.readBuffer();
        }
        if (!lowerV13 || !data.readInt()) {
          return ret;
        }
        return null;
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_varying);
        blr.addWord(this.length);
      }
    };
    var SQLVarQuad = class {
      decode(data, lowerV13) {
        var ret = data.readQuad();
        if (!lowerV13 || !data.readInt()) {
          return ret;
        }
        return null;
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_quad);
        blr.addShort(this.scale);
      }
    };
    var SQLVarBlob = class extends SQLVarQuad {
      calcBlr(blr) {
        blr.addByte(Const.blr_quad);
        blr.addShort(0);
      }
    };
    var SQLVarArray = class extends SQLVarQuad {
      calcBlr(blr) {
        blr.addByte(Const.blr_quad);
        blr.addShort(0);
      }
    };
    var SQLVarInt = class {
      decode(data, lowerV13) {
        var ret = data.readInt();
        if (this.scale) {
          ret = ret / ScaleDivisor[Math.abs(this.scale)];
        }
        if (!lowerV13 || !data.readInt()) {
          return ret;
        }
        return null;
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_long);
        blr.addShort(this.scale);
      }
    };
    var SQLVarShort = class extends SQLVarInt {
      calcBlr(blr) {
        blr.addByte(Const.blr_short);
        blr.addShort(this.scale);
      }
    };
    var SQLVarInt64 = class {
      decode(data, lowerV13) {
        var ret = data.readInt64();
        if (this.scale) {
          ret = ret / ScaleDivisor[Math.abs(this.scale)];
        }
        if (!lowerV13 || !data.readInt()) {
          return ret;
        }
        return null;
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_int64);
        blr.addShort(this.scale);
      }
    };
    var SQLVarInt128 = class {
      decode(data, lowerV13) {
        var retBigInt = BigInt(data.readInt128());
        if (retBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
          var ret = retBigInt.toString();
          var integerPart = ret.slice(0, Math.abs(this.scale) * -1);
          var decimalPart = ret.slice(Math.abs(this.scale) * -1);
          if (integerPart === "") integerPart = "0";
          ret = `${integerPart}.${decimalPart}`;
        } else {
          var ret = Number(retBigInt);
          ret = ret / ScaleDivisor[Math.abs(this.scale)];
        }
        if (!lowerV13 || !data.readInt()) {
          return ret;
        }
        return null;
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_int128);
        blr.addShort(this.scale);
      }
    };
    var SQLVarFloat = class {
      decode(data, lowerV13) {
        var ret = data.readFloat();
        if (!lowerV13 || !data.readInt()) {
          return ret;
        }
        return null;
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_float);
      }
    };
    var SQLVarDouble = class {
      decode(data, lowerV13) {
        var ret = data.readDouble();
        if (!lowerV13 || !data.readInt()) {
          return ret;
        }
        return null;
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_double);
      }
    };
    var SQLVarDate = class {
      decode(data, lowerV13) {
        var ret = data.readInt();
        if (!lowerV13 || !data.readInt()) {
          var d = /* @__PURE__ */ new Date(0);
          d.setMilliseconds((ret - DateOffset) * TimeCoeff + d.getTimezoneOffset() * MsPerMinute);
          return d;
        }
        return null;
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_sql_date);
      }
    };
    var SQLVarTime = class {
      decode(data, lowerV13) {
        var ret = data.readUInt();
        if (!lowerV13 || !data.readInt()) {
          var d = /* @__PURE__ */ new Date(0);
          d.setMilliseconds(Math.floor(ret / 10) + d.getTimezoneOffset() * MsPerMinute);
          return d;
        }
        return null;
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_sql_time);
      }
    };
    var SQLVarTimeStamp = class {
      decode(data, lowerV13) {
        var date = data.readInt();
        var time = data.readUInt();
        if (!lowerV13 || !data.readInt()) {
          var d = /* @__PURE__ */ new Date(0);
          d.setMilliseconds((date - DateOffset) * TimeCoeff + Math.floor(time / 10) + d.getTimezoneOffset() * MsPerMinute);
          return d;
        }
        return null;
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_timestamp);
      }
    };
    var SQLVarBoolean = class {
      decode(data, lowerV13) {
        var ret = data.readInt();
        if (!lowerV13 || !data.readInt()) {
          return Boolean(ret);
        }
        return null;
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_bool);
      }
    };
    var SQLParamInt = class {
      constructor(value) {
        this.value = value;
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_long);
        blr.addShort(0);
      }
      encode(data) {
        if (this.value != null) {
          data.addInt(this.value);
        } else {
          data.addInt(0);
          data.addInt(1);
        }
      }
    };
    var SQLParamInt64 = class {
      constructor(value) {
        this.value = value;
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_int64);
        blr.addShort(0);
      }
      encode(data) {
        if (this.value != null) {
          data.addInt64(this.value);
        } else {
          data.addInt64(0);
          data.addInt(1);
        }
      }
    };
    var SQLParamInt128 = class {
      constructor(value) {
        this.value = value;
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_int128);
        blr.addShort(0);
      }
      encode(data) {
        if (this.value != null) {
          data.addInt128(this.value);
        } else {
          data.addInt128(0);
          data.addInt(1);
        }
      }
    };
    var SQLParamDouble = class {
      constructor(value) {
        this.value = value;
      }
      encode(data) {
        if (this.value != null) {
          data.addDouble(this.value);
        } else {
          data.addDouble(0);
          data.addInt(1);
        }
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_double);
      }
    };
    var SQLParamString = class {
      constructor(value) {
        this.value = value;
      }
      encode(data) {
        if (this.value != null) {
          data.addText(this.value, Const.DEFAULT_ENCODING);
        } else {
          data.addInt(1);
        }
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_text);
        var len = this.value ? Buffer.byteLength(this.value, Const.DEFAULT_ENCODING) : 0;
        blr.addWord(len);
      }
    };
    var SQLParamQuad = class {
      constructor(value) {
        this.value = value;
      }
      encode(data) {
        if (this.value != null) {
          data.addInt(this.value.high);
          data.addInt(this.value.low);
        } else {
          data.addInt(0);
          data.addInt(0);
          data.addInt(1);
        }
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_quad);
        blr.addShort(0);
      }
    };
    var SQLParamDate = class {
      constructor(value) {
        this.value = value;
      }
      encode(data) {
        if (this.value != null) {
          var value = this.value.getTime() - this.value.getTimezoneOffset() * MsPerMinute;
          var time = value % TimeCoeff;
          var date = (value - time) / TimeCoeff + DateOffset;
          time *= 10;
          if (time < 0) {
            date--;
            time = TimeCoeff * 10 + time;
          }
          data.addInt(date);
          data.addUInt(time);
        } else {
          data.addInt(0);
          data.addUInt(0);
          data.addInt(1);
        }
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_timestamp);
      }
    };
    var SQLParamBool = class {
      constructor(value) {
        this.value = value;
      }
      encode(data) {
        if (this.value != null) {
          data.addInt(this.value ? 1 : 0);
        } else {
          data.addInt(0);
          data.addInt(1);
        }
      }
      calcBlr(blr) {
        blr.addByte(Const.blr_short);
        blr.addShort(0);
      }
    };
    module2.exports = {
      SQLVarArray,
      SQLVarDate,
      SQLVarBlob,
      SQLVarBoolean,
      SQLVarDouble,
      SQLVarInt,
      SQLVarInt64,
      SQLVarInt128,
      SQLVarFloat,
      SQLVarNull,
      SQLVarShort,
      SQLVarString,
      SQLVarText,
      SQLVarTime,
      SQLVarTimeStamp,
      SQLParamBool,
      SQLParamDate,
      SQLParamDouble,
      SQLParamInt,
      SQLParamInt64,
      SQLParamInt128,
      SQLParamQuad,
      SQLParamString
    };
  }
});

// ../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/service.js
var require_service = __commonJS({
  "../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/service.js"(exports2, module2) {
    var Events = require("events");
    var stream = require("stream");
    var Const = require_const();
    var { BlrReader } = require_serialize();
    var { doError } = require_callback();
    function isEmpty(obj) {
      for (var p in obj) return false;
      return true;
    }
    var SHUTDOWN_KIND = {
      0: Const.isc_spb_prp_shutdown_db,
      1: Const.isc_spb_prp_deny_new_transactions,
      2: Const.isc_spb_prp_deny_new_attachments
    };
    var SHUTDOWNEX_KIND = {
      0: Const.isc_spb_prp_force_shutdown,
      1: Const.isc_spb_prp_transactions_shutdown,
      2: Const.isc_spb_prp_attachments_shutdown
    };
    var SHUTDOWNEX_MODE = {
      //0: isc_spb_prp_sm_normal,
      1: Const.isc_spb_prp_sm_multi,
      2: Const.isc_spb_prp_sm_single,
      3: Const.isc_spb_prp_sm_full
    };
    var ShutdownMode = { NORMAL: 0, MULTI: 1, SINGLE: 2, FULL: 3 };
    var ShutdownKind = { FORCED: 0, DENY_TRANSACTION: 1, DENY_ATTACHMENT: 2 };
    var ServiceManager = class extends Events.EventEmitter {
      constructor(connection) {
        super();
        this.connection = connection;
        connection.svc = this;
      }
      _createOutputStream(optread, buffersize, callback) {
        var self2 = this;
        optread = optread || "byline";
        var t = new stream.Readable({ objectMode: optread === "byline" });
        t.__proto__._read = function() {
          var selfread = this;
          var fct = optread === "byline" ? self2.readline : self2.readeof;
          fct.call(self2, { buffersize }, function(err, data) {
            if (err) {
              selfread.push(err.message, Const.DEFAULT_ENCODING);
              return;
            }
            if (data.line && data.line.length)
              selfread.push(data.line, Const.DEFAULT_ENCODING);
            else
              selfread.push(null);
          });
        };
        callback(null, t);
      }
      _infosmapping = {
        "50": "dbinfo",
        "51": "licenses",
        "52": "licenseoptions",
        "53": "fbconfig",
        "54": "svcversion",
        "55": "fbversion",
        "56": "fbimplementation",
        "57": "fbcapatibilities",
        "58": "pathsecuritydb",
        "59": "fbenv",
        "60": "fbenvlock",
        "61": "fbenvmsg",
        "62": "",
        "63": "",
        "64": "",
        "65": "",
        "66": "limbotrans",
        "67": "",
        "68": "fbusers",
        "78": ""
      };
      _processcapabilities(blr, res) {
        var capArray = [
          "WAL_SUPPORT",
          "MULTI_CLIENT_SUPPORT",
          "REMOTE_HOP_SUPPORT",
          "NO_SVR_STATS_SUPPORT",
          "NO_DB_STATS_SUPPORT",
          "LOCAL_ENGINE_SUPPORT",
          "NO_FORCED_WRITE_SUPPORT",
          "NO_SHUTDOWN_SUPPORT",
          "NO_SERVER_SHUTDOWN_SUPPORT",
          "SERVER_CONFIG_SUPPORT",
          "QUOTED_FILENAME_SUPPORT"
        ];
        var dbcapa = res[this._infosmapping[57]] = [];
        var caps = blr.readInt32();
        for (var i = 0; i < capArray.length; ++i)
          if (caps & 1 << i)
            dbcapa.push(capArray[i]);
      }
      _processdbinfo(blr, res) {
        var tinfo = blr.readByteCode();
        var dbinfo = res[this._infosmapping[50]] = {};
        dbinfo.database = [];
        for (; tinfo != Const.isc_info_flag_end; tinfo = blr.readByteCode()) {
          switch (tinfo) {
            case Const.isc_spb_dbname:
              dbinfo.database.push(blr.readString());
              break;
            case Const.isc_spb_num_att:
              dbinfo.nbattachment = blr.readInt32();
              break;
            case Const.isc_spb_num_db:
              dbinfo.nbdatabase = blr.readInt32();
              break;
          }
        }
      }
      _processquery(buffer, callback) {
        var br = new BlrReader(buffer);
        var tinfo = br.readByteCode();
        var res = {};
        res.result = 0;
        for (; tinfo !== Const.isc_info_end; tinfo = br.readByteCode()) {
          switch (tinfo) {
            case Const.isc_info_svc_server_version:
            case Const.isc_info_svc_implementation:
            case Const.isc_info_svc_user_dbpath:
            case Const.isc_info_svc_get_env:
            case Const.isc_info_svc_get_env_lock:
            case Const.isc_info_svc_get_env_msg:
              res[this._infosmapping[tinfo]] = br.readString();
              break;
            case Const.isc_info_svc_version:
              res[this._infosmapping[tinfo]] = br.readInt32();
              break;
            case Const.isc_info_svc_svr_db_info:
              this._processdbinfo(br, res);
              break;
            case Const.isc_info_svc_limbo_trans:
              for (; tinfo !== isc_info_flag_end; tinfo = br.readByteCode())
                break;
            case Const.isc_info_svc_get_users:
              br.pos += 2;
              res[this._infosmapping[tinfo]] = [];
              break;
            case Const.isc_spb_sec_username:
              var tuser = res[this._infosmapping[68]];
              tuser.push({});
              tuser[tuser.length - 1].username = br.readString();
              break;
            case Const.isc_spb_sec_firstname:
              var tuser = res[this._infosmapping[68]];
              var user = tuser[tuser.length - 1];
              user.firstname = br.readString();
              break;
            case Const.isc_spb_sec_middlename:
              var tuser = res[this._infosmapping[68]];
              var user = tuser[tuser.length - 1];
              user.middlename = br.readString();
              break;
            case Const.isc_spb_sec_lastname:
              var tuser = res[this._infosmapping[68]];
              var user = tuser[tuser.length - 1];
              user.lastname = br.readString();
              break;
            case Const.isc_spb_sec_groupid:
              var tuser = res[this._infosmapping[68]];
              var user = tuser[tuser.length - 1];
              user.groupid = br.readInt32();
              break;
            case Const.isc_spb_sec_userid:
              var tuser = res[this._infosmapping[68]];
              var user = tuser[tuser.length - 1];
              user.userid = br.readInt32();
              break;
            case Const.isc_spb_sec_admin:
              var tuser = res[this._infosmapping[68]];
              var user = tuser[tuser.length - 1];
              user.admin = br.readInt32();
              break;
            case Const.isc_info_svc_line:
              res.line = br.readString();
              break;
            case Const.isc_info_svc_to_eof:
              res.line = br.readString();
              break;
            case Const.isc_info_truncated:
              res.result = 1;
              break;
            case Const.isc_info_data_not_ready:
              res.result = 2;
              break;
            case Const.isc_info_svc_timeout:
              res.result = 3;
              break;
            case Const.isc_info_svc_stdin:
              break;
            case Const.isc_info_svc_capabilities:
              this._processcapabilities(br, res);
              break;
          }
        }
        callback(null, res);
      }
      detach(callback, force) {
        var self2 = this;
        if (!force && self2.connection._pending.length > 0) {
          self2.connection._detachAuto = true;
          self2.connection._detachCallback = callback;
          return self2;
        }
        self2.connection.svcdetach(function(err, obj) {
          self2.connection.disconnect();
          self2.emit("detach", false);
          if (callback)
            callback(err, obj);
        }, force);
        return self2;
      }
      backup(options, callback) {
        var dbpath = options.database || this.connection.options.filename || this.connection.options.database;
        var verbose = options.verbose || false;
        var bckfiles = options.backupfiles || options.files || null;
        if (bckfiles) bckfiles = bckfiles.constructor !== Array ? [{ filename: bckfiles, sizefile: "0" }] : bckfiles;
        var factor = options.factor || 0;
        var ignorechecksums = options.ignorechecksums || false;
        var ignorelimbo = options.ignorelimbo || false;
        var metadataonly = options.metadataonly || false;
        var nogarbagecollect = options.nogarbasecollect || false;
        var olddescriptions = options.olddescriptions || false;
        var nontransportable = options.nontransportable || false;
        var convert = options.convert || false;
        var expand = options.expand || false;
        var notriggers = options.notriggers || false;
        if (dbpath == null || dbpath.length === 0) {
          doError(new Error("No database specified"), callback);
          return;
        }
        if (bckfiles == null || bckfiles.length === 0) {
          doError(new Error("No backup path specified"), callback);
          return;
        }
        var blr = this.connection._blr;
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_backup);
        blr.addString2(Const.isc_spb_dbname, dbpath, Const.DEFAULT_ENCODING);
        for (var i = 0; i < bckfiles.length; i++) {
          blr.addString2(Const.isc_spb_bkp_file, bckfiles[i].filename, Const.DEFAULT_ENCODING);
          if (i !== bckfiles.length - 1)
            blr.addString2(Const.isc_spb_bkp_length, bckfiles[i].sizefile, Const.DEFAULT_ENCODING);
        }
        if (factor)
          blr.addByteInt32(Const.isc_spb_bkp_factor, factor);
        var opts = 0;
        if (ignorechecksums) opts = opts | Const.isc_spb_bkp_ignore_checksums;
        if (ignorelimbo) opts = opts | Const.isc_spb_bkp_ignore_limbo;
        if (metadataonly) opts = opts | Const.isc_spb_bkp_metadata_only;
        if (nogarbagecollect) opts = opts | Const.isc_spb_bkp_no_garbage_collect;
        if (olddescriptions) opts = opts | Const.isc_spb_bkp_old_descriptions;
        if (nontransportable) opts = opts | Const.isc_spb_bkp_non_transportable;
        if (convert) opts = opts | Const.isc_spb_bkp_convert;
        if (expand) opts = opts | Const.isc_spb_bkp_expand;
        if (notriggers) opts = opts | Const.isc_spb_bkp_no_triggers;
        if (opts)
          blr.addByteInt32(Const.isc_spb_options, opts);
        if (verbose)
          blr.addByte(Const.isc_spb_verbose);
        var self2 = this;
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(options.optread, options.buffersize, callback);
        });
      }
      nbackup(options, callback) {
        var dbpath = options.database || this.connection.options.filename || this.connection.options.database;
        var bckfile = options.backupfile || options.file || null;
        var level = options.level || 0;
        var notriggers = options.notriggers || false;
        var direct = options.direct || "on";
        if (dbpath == null || dbpath.length === 0) {
          doError(new Error("No database specified"), callback);
          return;
        }
        if (bckfile == null || bckfile.length === 0) {
          doError(new Error("No backup path specified"), callback);
          return;
        }
        var blr = this.connection._blr;
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_nbak);
        blr.addString2(Const.isc_spb_dbname, dbpath, Const.DEFAULT_ENCODING);
        blr.addString2(Const.isc_spb_nbk_file, bckfile, Const.DEFAULT_ENCODING);
        blr.addByteInt32(Const.isc_spb_nbk_level, level);
        blr.addString2(Const.isc_spb_nbk_direct, direct, Const.DEFAULT_ENCODING);
        var opts = 0;
        if (notriggers) opts = opts | Const.isc_spb_nbk_no_triggers;
        blr.addByteInt32(Const.isc_spb_options, opts);
        var self2 = this;
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(options.optread, options.buffersize, callback);
        });
      }
      restore(options, callback) {
        var bckfiles = options.backupfiles || options.files || null;
        if (bckfiles) bckfiles = bckfiles.constructor !== Array ? [bckfiles] : bckfiles;
        var dbfile = options.database || this.connection.options.filename || this.connection.options.database;
        ;
        var verbose = options.verbose || false;
        var cachebuffers = options.cachebuffers || 2048;
        var pagesize = options.pagesize || 4096;
        var readonly = options.readonly || false;
        var deactivateindexes = options.deactivateindexes || false;
        var noshadow = options.noshadow || false;
        var novalidity = options.novalidity || false;
        var individualcommit = options.individualcommit || true;
        var replace = options.replace || false;
        var create = options.create || true;
        var useallspace = options.useallspace || false;
        var metadataonly = options.metadataonly || false;
        var fixfssdata = options.fixfssdata || null;
        var fixfssmetadata = options.fixfssmetadata || null;
        if (bckfiles == null || bckfiles.length === 0) {
          doError(new Error("No backup file specified"), callback);
          return;
        }
        if (dbfile == null || dbfile.length === 0) {
          doError(new Error("No database path specified"), callback);
          return;
        }
        var blr = this.connection._blr;
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_restore);
        for (var i = 0; i < bckfiles.length; i++) {
          blr.addString2(Const.isc_spb_bkp_file, bckfiles[i], Const.DEFAULT_ENCODING);
        }
        blr.addString2(Const.isc_spb_dbname, dbfile, Const.DEFAULT_ENCODING);
        blr.addByte(Const.isc_spb_res_buffers);
        blr.addInt32(cachebuffers);
        blr.addByte(Const.isc_spb_res_page_size);
        blr.addInt32(pagesize);
        blr.addByte(Const.isc_spb_res_access_mode);
        if (readonly)
          blr.addByte(Const.isc_spb_prp_am_readonly);
        else
          blr.addByte(Const.isc_spb_prp_am_readwrite);
        if (fixfssdata) blr.addString2(Const.isc_spb_res_fix_fss_data, fixfssdata, Const.DEFAULT_ENCODING);
        if (fixfssmetadata) blr.addString2(Const.isc_spb_res_fix_fss_metadata, fixfssmetadata, Const.DEFAULT_ENCODING);
        var opts = 0;
        if (deactivateindexes) opts = opts | Const.isc_spb_res_deactivate_idx;
        if (noshadow) opts = opts | Const.isc_spb_res_no_shadow;
        if (novalidity) opts = opts | Const.isc_spb_res_no_validity;
        if (individualcommit) opts = opts | Const.isc_spb_res_one_at_a_time;
        if (replace) opts = opts | Const.isc_spb_res_replace;
        if (create) opts = opts | Const.isc_spb_res_create;
        if (useallspace) opts = opts | Const.isc_spb_res_use_all_space;
        if (metadataonly) opts = opts | Const.isc_spb_res_fix_fss_metadata;
        if (opts)
          blr.addByteInt32(Const.isc_spb_options, opts);
        if (verbose)
          blr.addByte(Const.isc_spb_verbose);
        var self2 = this;
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(options.optread, options.buffersize, callback);
        });
      }
      nrestore(options, callback) {
        var bckfiles = options.backupfiles || options.files || null;
        if (bckfiles) bckfiles = bckfiles.constructor !== Array ? [bckfiles] : bckfiles;
        var dbpath = options.database || this.connection.options.filename || this.connection.options.database;
        if (bckfiles == null || bckfiles.length === 0) {
          doError(new Error("No backup file specified"), callback);
          return;
        }
        if (dbpath == null || bckfiles.length === 0) {
          doError(new Error("No database path specified"), callback);
          return;
        }
        var blr = this.connection._blr;
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_nrest);
        for (var i = 0; i < bckfiles.length; i++) {
          blr.addString2(Const.isc_spb_nbk_file, bckfiles[i], Const.DEFAULT_ENCODING);
        }
        blr.addString2(Const.isc_spb_dbname, dbpath, Const.DEFAULT_ENCODING);
        var self2 = this;
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(options.optread, options.buffersize, callback);
        });
      }
      _fixpropertie(options, callback) {
        var dbpath = options.database || this.connection.options.filename || this.connection.options.database;
        var dialect = options.dialect || null;
        var sweep = options.sweepinterval || null;
        var pagebuffers = options.nbpagebuffers || null;
        var online = options.bringonline || false;
        var shutdown = options.shutdown != null ? options.shutdown : null;
        var shutdowndelay = options.shutdowndelay || 0;
        var shutdownmode = options.shutdownmode;
        var shadow = options.activateshadow || false;
        var forcewrite = options.forcewrite;
        var reservespace = options.reservespace;
        var accessmode = options.accessmode;
        if (dbpath == null || dbpath.length === 0) {
          doError(new Error("No database specified"), callback);
          return;
        }
        var blr = this.connection._blr;
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_properties);
        blr.addString2(Const.isc_spb_dbname, dbpath, Const.DEFAULT_ENCODING);
        if (dialect) blr.addByteInt32(Const.isc_spb_prp_set_sql_dialect, dialect);
        if (sweep) blr.addByteInt32(Const.isc_spb_prp_sweep_interval, sweep);
        if (pagebuffers) blr.addByteInt32(Const.isc_spb_prp_page_buffers, pagebuffers);
        if (shutdown != null) {
          if (shutdownmode != null) {
            if (SHUTDOWNEX_KIND[shutdown] === void 0) {
              doError(new Error("Invalid shutdown kind"), callback);
              return;
            }
            if (SHUTDOWNEX_MODE[shutdownmode] === void 0) {
              doError(new Error("Invalid shutdown mode"), callback);
              return;
            }
            blr.addBytes([Const.isc_spb_prp_shutdown_mode, SHUTDOWNEX_MODE[shutdownmode]]);
            blr.addByteInt32(SHUTDOWNEX_KIND[shutdown], shutdowndelay);
          } else {
            blr.addByteInt32(SHUTDOWN_KIND[shutdown], shutdowndelay);
          }
        }
        if (forcewrite) blr.addBytes([Const.isc_spb_prp_write_mode, Const.isc_spb_prp_wm_sync]);
        if (forcewrite === false) blr.addBytes([Const.isc_spb_prp_write_mode, Const.isc_spb_prp_wm_async]);
        if (accessmode === 1) blr.addBytes([Const.isc_spb_prp_access_mode, Const.isc_spb_prp_am_readwrite]);
        if (accessmode === 0) blr.addBytes([Const.isc_spb_prp_access_mode, Const.isc_spb_prp_am_readonly]);
        if (reservespace) blr.addBytes([Const.isc_spb_prp_reserve_space, Const.isc_spb_prp_res]);
        if (reservespace != null && !reservespace) blr.addBytes([Const.isc_spb_prp_reserve_space, Const.isc_spb_prp_res_use_full]);
        var opts = 0;
        if (shadow) opts = opts | Const.isc_spb_prp_activate;
        if (online) opts = opts | Const.isc_spb_prp_db_online;
        if (opts)
          blr.addByteInt32(Const.isc_spb_options, opts);
        var self2 = this;
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(options.optread, options.buffersize, callback);
        });
      }
      setDialect(db, dialect, callback) {
        this._fixpropertie({ database: db, dialect }, callback);
      }
      setSweepinterval(db, sweepinterval, callback) {
        this._fixpropertie({ database: db, sweepinterval }, callback);
      }
      setCachebuffer(db, nbpages, callback) {
        this._fixpropertie({ database: db, nbpagebuffers: nbpages }, callback);
      }
      BringOnline(db, callback) {
        this._fixpropertie({ database: db, bringonline: true }, callback);
      }
      Shutdown(db, kind, delay, mode, callback) {
        if (mode instanceof Function) {
          callback = mode;
          mode = void 0;
        }
        this._fixpropertie({ database: db, shutdown: kind, shutdowndelay: delay, shutdownmode: mode }, callback);
      }
      setShadow(db, val, callback) {
        this._fixpropertie({ database: db, activateshadow: val }, callback);
      }
      setForcewrite(db, val, callback) {
        this._fixpropertie({ database: db, forcewrite: val }, callback);
      }
      setReservespace(db, val, callback) {
        this._fixpropertie({ database: db, reservespace: val }, callback);
      }
      setReadonlyMode(db, callback) {
        this._fixpropertie({ database: db, accessmode: 0 }, callback);
      }
      setReadwriteMode(db, callback) {
        this._fixpropertie({ database: db, accessmode: 1 }, callback);
      }
      validate(options, callback) {
        var dbpath = options.database || this.connection.options.filename || this.connection.options.database;
        var checkdb = options.checkdb || false;
        var ignorechecksums = options.ignorechecksums || false;
        var killshadows = options.killshadows || false;
        var mend = options.mend || false;
        var validate = options.validate || false;
        var full = options.full || false;
        var sweep = options.sweep || false;
        var listlimbo = options.listlimbo || false;
        var icu = options.icu || false;
        if (dbpath == null || dbpath.length === 0) {
          doError(new Error("No database specified"), callback);
          return;
        }
        var blr = this.connection._blr;
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_repair);
        blr.addString2(Const.isc_spb_dbname, dbpath, Const.DEFAULT_ENCODING);
        var opts = 0;
        if (checkdb) opts = opts | Const.isc_spb_rpr_check_db;
        if (ignorechecksums) opts = opts | Const.isc_spb_rpr_ignore_checksum;
        if (killshadows) opts = opts | Const.isc_spb_rpr_kill_shadows;
        if (mend) opts = opts | Const.isc_spb_rpr_mend_db;
        if (validate) opts = opts | Const.isc_spb_rpr_validate_db;
        if (full) opts = opts | Const.isc_spb_rpr_full;
        if (sweep) opts = opts | Const.isc_spb_rpr_sweep_db;
        if (listlimbo) opts = opts | Const.isc_spb_rpr_list_limbo_trans;
        if (icu) opts = opts | Const.isc_spb_rpr_icu;
        blr.addByteInt32(Const.isc_spb_options, opts);
        var self2 = this;
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(options.optread, options.buffersize, callback);
        });
      }
      commit(db, transactid, callback) {
        var dbpath = db || this.connection.options.filename || this.connection.options.database;
        if (dbpath == null || dbpath.length === 0) {
          doError(new Error("No database specified"), callback);
          return;
        }
        var blr = this.connection._blr;
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_repair);
        blr.addString2(Const.isc_spb_dbname, dbpath, Const.DEFAULT_ENCODING);
        blr.addByteInt32(Const.isc_spb_rpr_commit_trans, transactid);
        var self2 = this;
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(null, null, callback);
        });
      }
      rollback(db, transactid, callback) {
        var dbpath = db || this.connection.options.filename || this.connection.options.database;
        if (dbpath == null || dbpath.length === 0) {
          doError(new Error("No database specified"), callback);
          return;
        }
        var blr = this.connection._blr;
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_repair);
        blr.addString2(Const.isc_spb_dbname, dbpath, Const.DEFAULT_ENCODING);
        blr.addByteInt32(Const.isc_spb_rpr_rollback_trans, transactid);
        var self2 = this;
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(null, null, callback);
        });
      }
      recover(db, transactid, callback) {
        var dbpath = db || this.connection.options.filename || this.connection.options.database;
        if (dbpath == null || dbpath.length === 0) {
          doError(new Error("No database specified"), callback);
          return;
        }
        var blr = this.connection._blr;
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_repair);
        blr.addString2(Const.isc_spb_dbname, dbpath, Const.DEFAULT_ENCODING);
        blr.addByteInt32(Const.isc_spb_rpr_recover_two_phase, transactid);
        var self2 = this;
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(null, null, callback);
        });
      }
      getStats(options, callback) {
        var dbpath = options.database || this.connection.options.filename || this.connection.options.database;
        var record = options.record || false;
        var nocreation = options.nocreation || false;
        var tables = options.tables || false;
        var pages = options.pages || false;
        var header = options.header || false;
        var indexes = options.indexes || false;
        var tablesystem = options.tablesystem || false;
        var encryption = options.encryption || false;
        var objects = options.objects || null;
        if (dbpath == null || dbpath.length === 0) {
          doError(new Error("No database specified"), callback);
          return;
        }
        var blr = this.connection._blr;
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_db_stats);
        blr.addString2(Const.isc_spb_dbname, dbpath, Const.DEFAULT_ENCODING);
        var opts = 0;
        if (record) opts = opts | Const.isc_spb_sts_record_versions;
        if (nocreation) opts = opts | Const.isc_spb_sts_nocreation;
        if (tables) opts = opts | Const.isc_spb_sts_table;
        if (pages) opts = opts | Const.isc_spb_sts_data_pages;
        if (header) opts = opts | Const.isc_spb_sts_hdr_pages;
        if (indexes) opts = opts | Const.isc_spb_sts_idx_pages;
        if (tablesystem) opts = opts | Const.isc_spb_sts_sys_relations;
        if (encryption) opts = opts | Const.isc_spb_sts_encryption;
        if (opts)
          blr.addByteInt32(Const.isc_spb_options, opts);
        if (objects) blr.addString2(Const.isc_spb_command_line, objects, Const.DEFAULT_ENCODING);
        var self2 = this;
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(options.optread, options.buffersize, callback);
        });
      }
      getLog(options, callback) {
        var self2 = this;
        var blr = this.connection._blr;
        var optread = options.optread || "byline";
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_get_fb_log);
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(optread, options.buffersize, callback);
        });
      }
      getUsers(username, callback) {
        var self2 = this;
        var blr = this.connection._blr;
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_display_user);
        if (username) blr.addString2(Const.isc_spb_sec_username, username, Const.DEFAULT_ENCODING);
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2.readusers({}, callback);
        });
      }
      addUser(username, password, options, callback) {
        var rolename = options.rolename || null;
        var groupname = options.groupname || null;
        var firsname = options.firstname || null;
        var middlename = options.middlename || null;
        var lastname = options.lastname || null;
        var userid = options.userid || null;
        var groupid = options.groupid || null;
        var admin = options.admin || null;
        var blr = this.connection._blr;
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_add_user);
        blr.addString2(Const.isc_spb_sec_username, username, Const.DEFAULT_ENCODING);
        blr.addString2(Const.isc_spb_sec_password, password, Const.DEFAULT_ENCODING);
        if (rolename) blr.addString2(Const.isc_dpb_sql_role_name, rolename, Const.DEFAULT_ENCODING);
        if (groupname) blr.addString2(Const.isc_spb_sec_groupname, groupname, Const.DEFAULT_ENCODING);
        if (firsname) blr.addString2(Const.isc_spb_sec_firstname, firsname, Const.DEFAULT_ENCODING);
        if (middlename) blr.addString2(Const.isc_spb_sec_middlename, middlename, Const.DEFAULT_ENCODING);
        if (lastname) blr.addString2(Const.isc_spb_sec_lastname, lastname, Const.DEFAULT_ENCODING);
        if (userid != null) blr.addByteInt32(Const.isc_spb_sec_userid, userid);
        if (groupid != null) blr.addByteInt32(Const.isc_spb_sec_groupid, groupid);
        if (admin != null) blr.addByteInt32(Const.isc_spb_sec_admin, admin);
        var self2 = this;
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(options.optread, options.buffersize, callback);
        });
      }
      editUser(username, options, callback) {
        var rolename = options.rolename || null;
        var groupname = options.groupname || null;
        var firsname = options.firstname || null;
        var middlename = options.middlename || null;
        var lastname = options.lastname || null;
        var userid = options.userid || null;
        var groupid = options.groupid || null;
        var admin = options.admin || null;
        var password = options.password || null;
        var blr = this.connection._blr;
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_modify_user);
        blr.addString2(Const.isc_spb_sec_username, username, Const.DEFAULT_ENCODING);
        if (password) blr.addString2(Const.isc_spb_sec_password, password, Const.DEFAULT_ENCODING);
        if (rolename) blr.addString2(Const.isc_dpb_sql_role_name, rolename, Const.DEFAULT_ENCODING);
        if (groupname) blr.addString2(Const.isc_spb_sec_groupname, groupname, Const.DEFAULT_ENCODING);
        if (firsname) blr.addString2(Const.isc_spb_sec_firstname, firsname, Const.DEFAULT_ENCODING);
        if (middlename) blr.addString2(Const.isc_spb_sec_middlename, middlename, Const.DEFAULT_ENCODING);
        if (lastname) blr.addString2(Const.isc_spb_sec_lastname, lastname, Const.DEFAULT_ENCODING);
        if (userid != null) blr.addByteInt32(Const.isc_spb_sec_userid, userid);
        if (groupid != null) blr.addByteInt32(Const.isc_spb_sec_groupid, groupid);
        if (admin != null) blr.addByteInt32(Const.isc_spb_sec_admin, admin);
        var self2 = this;
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(options.optread, options.buffersize, callback);
        });
      }
      removeUser(username, rolename, callback) {
        var blr = this.connection._blr;
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_delete_user);
        blr.addString2(Const.isc_spb_sec_username, username, Const.DEFAULT_ENCODING);
        if (rolename) blr.addString2(Const.isc_dpb_sql_role_name, rolename, Const.DEFAULT_ENCODING);
        var self2 = this, options = {};
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(options.optread, options.buffersize, callback);
        });
      }
      getFbserverInfos(infos, options, callback) {
        var buffersize = options.buffersize || 2048;
        var timeout = options.timeout || 1;
        var opts = {
          "dbinfo": Const.isc_info_svc_svr_db_info,
          "fbconfig": Const.isc_info_svc_get_config,
          "svcversion": Const.isc_info_svc_version,
          "fbversion": Const.isc_info_svc_server_version,
          "fbimplementation": Const.isc_info_svc_implementation,
          "fbcapatibilities": Const.isc_info_svc_capabilities,
          "pathsecuritydb": Const.isc_info_svc_user_dbpath,
          "fbenv": Const.isc_info_svc_get_env,
          "fbenvlock": Const.isc_info_svc_get_env_lock,
          "fbenvmsg": Const.isc_info_svc_get_env_msg
        };
        var tops = [], empty = isEmpty(infos);
        for (let popts in opts)
          if (empty || infos[popts])
            tops.push(opts[popts]);
        var self2 = this;
        this.connection.svcquery(tops, buffersize, timeout, function(err, data) {
          if (err || !data.buffer) {
            doError(new Error(err || "Bad query return"), callback);
            return;
          }
          self2._processquery(data.buffer, callback);
        });
      }
      startTrace(options, callback) {
        var self2 = this;
        var blr = this.connection._blr;
        var configfile = options.configfile || "";
        var tracename = options.tracename || "";
        if (configfile.length === 0) {
          doError(new Error("No config filename specified"), callback);
          return;
        }
        if (tracename.length === 0) {
          doError(new Error("No tracename specified"), callback);
          return;
        }
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_trace_start);
        blr.addString2(Const.isc_spb_trc_cfg, configfile, Const.DEFAULT_ENCODING);
        blr.addString2(Const.isc_spb_trc_name, tracename, Const.DEFAULT_ENCODING);
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(options.optread, options.buffersize, callback);
        });
      }
      suspendTrace(options, callback) {
        var self2 = this;
        var blr = this.connection._blr;
        var traceid = options.traceid || null;
        if (traceid == null) {
          doError(new Error("No traceid specified"), callback);
          return;
        }
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_trace_suspend);
        blr.addByteInt32(Const.isc_spb_trc_id, traceid);
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(options.optread, options.buffersize, callback);
        });
      }
      resumeTrace(options, callback) {
        var self2 = this;
        var blr = this.connection._blr;
        var traceid = options.traceid || null;
        if (traceid == null) {
          doError(new Error("No traceid specified"), callback);
          return;
        }
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_trace_resume);
        blr.addByteInt32(Const.isc_spb_trc_id, traceid);
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(options.optread, options.buffersize, callback);
        });
      }
      stopTrace(options, callback) {
        var self2 = this;
        var blr = this.connection._blr;
        var traceid = options.traceid || null;
        if (traceid == null) {
          doError(new Error("No traceid specified"), callback);
          return;
        }
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_trace_stop);
        blr.addByteInt32(Const.isc_spb_trc_id, traceid);
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(options.optread, options.buffersize, callback);
        });
      }
      getTraceList(options, callback) {
        var self2 = this;
        var blr = this.connection._blr;
        blr.pos = 0;
        blr.addByte(Const.isc_action_svc_trace_list);
        this.connection.svcstart(blr, function(err, data) {
          if (err) {
            doError(new Error(err), callback);
            return;
          }
          self2._createOutputStream(options.optread, options.buffersize, callback);
        });
      }
      readline(options, callback) {
        var buffersize = options.buffersize || 2048;
        var timeout = options.timeout || 60;
        var self2 = this;
        this.connection.svcquery([Const.isc_info_svc_line], buffersize, timeout, function(err, data) {
          if (err || !data.buffer) {
            doError(new Error(err || "Bad query return"), callback);
            return;
          }
          self2._processquery(data.buffer, callback);
        });
      }
      readeof(options, callback) {
        var buffersize = options.buffersize || 8 * 1024;
        var timeout = options.timeout || 60;
        var self2 = this;
        this.connection.svcquery([Const.isc_info_svc_to_eof], buffersize, timeout, function(err, data) {
          if (err || !data.buffer) {
            doError(new Error(err || "Bad query return"), callback);
            return;
          }
          self2._processquery(data.buffer, callback);
        });
      }
      hasRunningAction(options, callback) {
        var buffersize = options.buffersize || 2048;
        var timeout = options.timeout || 60;
        var self2 = this;
        this.connection.svcquery([Const.isc_info_svc_running], buffersize, timeout, function(err, data) {
          if (err || !data.buffer) {
            doError(new Error(err || "Bad query return"), callback);
            return;
          }
          self2._processquery(data.buffer, callback);
        });
      }
      readusers(options, callback) {
        var buffersize = options.buffersize || 2048;
        var timeout = options.timeout || 60;
        var self2 = this;
        this.connection.svcquery([Const.isc_info_svc_get_users], buffersize, timeout, function(err, data) {
          if (err || !data.buffer) {
            doError(new Error(err || "Bad query return"), callback);
            return;
          }
          self2._processquery(data.buffer, callback);
        });
      }
      readlimbo(options, callback) {
        var buffersize = options.buffersize || 2048;
        var timeout = options.timeout || 60;
        var self2 = this;
        this.connection.svcquery([Const.isc_info_svc_limbo_trans], buffersize, timeout, function(err, data) {
          if (err || !data.buffer) {
            doError(new Error(err || "Bad query return"), callback);
            return;
          }
          self2._processquery(data.buffer, callback);
        });
      }
    };
    ServiceManager.ShutdownMode = ShutdownMode;
    ServiceManager.ShutdownKind = ShutdownKind;
    module2.exports = ServiceManager;
  }
});

// ../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/firebird.msg.json
var require_firebird_msg = __commonJS({
  "../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/firebird.msg.json"(exports2, module2) {
    module2.exports = {
      "335544321": "Arithmetic exception, numeric overflow, or string truncation",
      "335544322": "Invalid database key",
      "335544323": "File @1 is not a valid database",
      "335544324": "Invalid database handle (no active connection)",
      "335544325": "Bad parameters on attach or create database",
      "335544326": "Unrecognized database parameter block",
      "335544327": "Invalid request handle",
      "335544328": "Invalid BLOB handle",
      "335544329": "Invalid BLOB ID",
      "335544330": "Invalid parameter in transaction parameter block",
      "335544331": "Invalid format for transaction parameter block",
      "335544332": "Invalid transaction handle (expecting explicit transaction start)",
      "335544333": "Internal gds software consistency check (@1)",
      "335544334": 'Conversion error from string "@1"',
      "335544335": "Database file appears corrupt (@1)",
      "335544336": "Deadlock",
      "335544337": "Attempt to start more than @1 transactions",
      "335544338": "No match for first value expression",
      "335544339": "Information type inappropriate for object specified",
      "335544340": "No information of this type available for object specified",
      "335544341": "Unknown information item",
      "335544342": "Action cancelled by trigger (@1) to preserve data integrity",
      "335544343": "Invalid request BLR at offset @1",
      "335544344": 'I/O error for file "@2"',
      "335544345": "Lock conflict on no wait transaction",
      "335544346": "Corrupt system table",
      "335544347": 'Validation error for column @1, value "@2"',
      "335544348": "No current record for fetch operation",
      "335544349": 'Attempt to store duplicate value ( visible to active transactions ) in unique index "@1"',
      "335544350": "Program attempted to exit without finishing database",
      "335544351": "Unsuccessful metadata update",
      "335544352": "No permission for @1 access to @2 @3",
      "335544353": "Transaction is not in limbo",
      "335544354": "Invalid database key",
      "335544355": "BLOB was not closed",
      "335544356": "Metadata is obsolete",
      "335544357": "Cannot disconnect database with open transactions (@1 active)",
      "335544358": "Message length error ( encountered @1, expected @2)",
      "335544359": "Attempted update of read - only column",
      "335544360": "Attempted update of read-only table",
      "335544361": "Attempted update during read - only transaction",
      "335544362": "Cannot update read-only view @1",
      "335544363": "No transaction for request",
      "335544364": "Request synchronization error",
      "335544365": "Request referenced an unavailable database",
      "335544366": "Segment buffer length shorter than expected",
      "335544367": "Attempted retrieval of more segments than exist",
      "335544368": "Attempted invalid operation on a BLOB",
      "335544369": "Attempted read of a new, open BLOB",
      "335544370": "Attempted action on blob outside transaction",
      "335544371": "Attempted write to read-only BLOB",
      "335544372": "Attempted reference to BLOB in unavailable database",
      "335544373": "Operating system directive @1 failed",
      "335544374": "Attempt to fetch past the last record in a record stream",
      "335544375": "Unavailable database",
      "335544376": "Table @1 was omitted from the transaction reserving list",
      "335544377": "Request includes a DSRI extension not supported in this implementation",
      "335544378": "Feature is not supported",
      "335544379": "Unsupported on - disk structure for file @1; found @2.@3, support @4.@5",
      "335544380": "Wrong number of arguments on call",
      "335544381": "Implementation limit exceeded",
      "335544382": "@1",
      "335544383": "Unrecoverable conflict with limbo transaction @1",
      "335544384": "Internal error",
      "335544385": "Internal error",
      "335544386": "Too many requests",
      "335544387": "Internal error",
      "335544388": "Block size exceeds implementation restriction",
      "335544389": "Buffer exhausted",
      "335544390": "BLR syntax error: expected @1 at offset @2, encountered @3",
      "335544391": "Buffer in use",
      "335544392": "Internal error",
      "335544393": "Request in use",
      "335544394": "Incompatible version of on-disk structure",
      "335544395": "Table @1 is not defined",
      "335544396": "Column @1 is not defined in table @2",
      "335544397": "Internal error",
      "335544398": "Internal error",
      "335544399": "Internal error",
      "335544400": "Internal error",
      "335544401": "Internal error",
      "335544402": "Internal error",
      "335544403": "Page @1 is of wrong type (expected @2, found @3)",
      "335544404": "Database corrupted",
      "335544405": "Checksum error on database page @1",
      "335544406": "Index is broken",
      "335544407": "Database handle not zero",
      "335544408": "Transaction handle not zero",
      "335544409": "Transaction - request mismatch ( synchronization error )",
      "335544410": "Bad handle count",
      "335544411": "Wrong version of transaction parameter block",
      "335544412": "Unsupported BLR version (expected @1, encountered @2)",
      "335544413": "Wrong version of database parameter block",
      "335544414": "BLOB and array data types are not supported for @1 operation",
      "335544415": "Database corrupted",
      "335544416": "Internal error",
      "335544417": "Internal error",
      "335544418": "Transaction in limbo",
      "335544419": "Transaction not in limbo",
      "335544420": "Transaction outstanding",
      "335544421": "Connection rejected by remote interface",
      "335544422": "Internal error",
      "335544423": "Internal error",
      "335544424": "No lock manager available",
      "335544425": "Context already in use (BLR error)",
      "335544426": "Context not defined (BLR error)",
      "335544427": "Data operation not supported",
      "335544428": "Undefined message number",
      "335544429": "Bad parameter number",
      "335544430": "Unable to allocate memory from operating system",
      "335544431": "Blocking signal has been received",
      "335544432": "Lock manager error",
      "335544433": 'communication error with journal "@1"',
      "335544434": 'Key size exceeds implementation restriction for index "@1"',
      "335544435": "Null segment of UNIQUE KEY",
      "335544436": "SQL error code = @1",
      "335544437": "Wrong DYN version",
      "335544438": "Function @1 is not defined",
      "335544439": "Function @1 could not be matched",
      "335544440": "-",
      "335544441": "Database detach completed with errors",
      "335544442": "Database system cannot read argument @1",
      "335544443": "Database system cannot write argument @1",
      "335544444": "Operation not supported",
      "335544445": "@1 extension error",
      "335544446": "Not updatable",
      "335544447": "No rollback performed",
      "335544448": "[no associated message]",
      "335544449": "[no associated message]",
      "335544450": "@1",
      "335544451": "Update conflicts with concurrent update",
      "335544452": "product @1 is not licensed",
      "335544453": "Object @1 is in use",
      "335544454": "Filter not found to convert type @1 to type @2",
      "335544455": "Cannot attach active shadow file",
      "335544456": "Invalid slice description language at offset @1",
      "335544457": "Subscript out of bounds",
      "335544458": "Column not array or invalid dimensions (expected @1, encountered @2)",
      "335544459": "Record from transaction @1 is stuck in limbo",
      "335544460": "A file in manual shadow @1 is unavailable",
      "335544461": "Secondary server attachments cannot validate databases",
      "335544462": "secondary server attachments cannot start journaling",
      "335544463": "Generator @1 is not defined",
      "335544464": "Secondary server attachments cannot start logging",
      "335544465": "Invalid BLOB type for operation",
      "335544466": 'Violation of FOREIGN KEY constraint "@1" on table "@2"',
      "335544467": "Minor version too high found @1 expected @2",
      "335544468": "Transaction @1 is @2",
      "335544469": "Transaction marked invalid by I/O error",
      "335544470": "Cache buffer for page @1 invalid",
      "335544471": "There is no index in table @1 with id @2",
      "335544472": "Your user name and password are not defined. Ask your database\nadministrator to set up a Firebird login\n",
      "335544473": "Invalid bookmark handle",
      "335544474": "Invalid lock level @1",
      "335544475": "Lock on table @1 conflicts with existing lock",
      "335544476": "Requested record lock conflicts with existing lock",
      "335544477": "Maximum indexes per table (@1) exceeded",
      "335544478": "enable journal for database before starting online dump",
      "335544479": "online dump failure. Retry dump",
      "335544480": "an online dump is already in progress",
      "335544481": "no more disk/tape space.  Cannot continue online dump",
      "335544482": "journaling allowed only if database has Write-ahead Log",
      "335544483": "maximum number of online dump files that can be specified is 16",
      "335544484": "error in opening Write-ahead Log file during recovery",
      "335544485": "Invalid statement handle",
      "335544486": "Write-ahead log subsystem failure",
      "335544487": "WAL Writer error",
      "335544488": "Log file header of @1 too small",
      "335544489": "Invalid version of log file @1",
      "335544490": "Log file @1 not latest in the chain but open flag still set",
      "335544491": "Log file @1 not closed properly; database recovery may be required",
      "335544492": "Database name in the log file @1 is different",
      "335544493": "Unexpected end of log file @1 at offset @2",
      "335544494": "Incomplete log record at offset @1 in log file @2",
      "335544495": "Log record header too small at offset @1 in log file @",
      "335544496": "Log block too small at offset @1 in log file @2",
      "335544497": "Illegal attempt to attach to an uninitialized WAL segment for @1",
      "335544498": "Invalid WAL parameter block option @1",
      "335544499": "Cannot roll over to the next log file @1",
      "335544500": "Database does not use Write-ahead Log",
      "335544501": "cannot drop log file when journaling is enabled",
      "335544502": "Reference to invalid stream number",
      "335544503": "WAL subsystem encountered error",
      "335544504": "WAL subsystem corrupted",
      "335544505": "must specify archive file when enabling long term journal for databases with round-robin log files",
      "335544506": "Database @1 shutdown in progress",
      "335544507": "Refresh range number @1 already in use",
      "335544508": "Refresh range number @1 not found",
      "335544509": "CHARACTER SET @1 is not defined",
      "335544510": "Lock time-out on wait transaction",
      "335544511": "Procedure @1 is not defined",
      "335544512": "Input parameter mismatch for procedure @1",
      "335544513": "Database @1: WAL subsystem bug for pid @2\n@3",
      "335544514": "Could not expand the WAL segment for database @1",
      "335544515": "Status code @1 unknown",
      "335544516": "Exception @1 not defined",
      "335544517": "Exception @1",
      "335544518": "Restart shared cache manager",
      "335544519": "Invalid lock handle",
      "335544520": "long-term journaling already enabled",
      "335544521": "Unable to roll over please see Firebird log.",
      "335544522": "WAL I/O error.  Please see Firebird log.",
      "335544523": "WAL writer - Journal server communication error.  Please see Firebird log.",
      "335544524": "WAL buffers cannot be increased.  Please see Firebird log.",
      "335544525": "WAL setup error.  Please see Firebird log.",
      "335544526": "obsolete",
      "335544527": "Cannot start WAL writer for the database @1",
      "335544528": "Database @1 shutdown",
      "335544529": "Cannot modify an existing user privilege",
      "335544530": "Cannot delete PRIMARY KEY being used in FOREIGN KEY definition",
      "335544531": "Column used in a PRIMARY constraint must be NOT NULL",
      "335544532": "Name of Referential Constraint not defined in constraints table",
      "335544533": "Non-existent PRIMARY or UNIQUE KEY specified for FOREIGN KEY",
      "335544534": "Cannot update constraints (RDB$REF_CONSTRAINTS)",
      "335544535": "Cannot update constraints (RDB$CHECK_CONSTRAINTS)",
      "335544536": "Cannot delete CHECK constraint entry (RDB$CHECK_CONSTRAINTS)",
      "335544537": "Cannot delete index segment used by an Integrity Constraint",
      "335544538": "Cannot update index segment used by an Integrity Constraint",
      "335544539": "Cannot delete index used by an Integrity Constraint",
      "335544540": "Cannot modify index used by an Integrity Constraint",
      "335544541": "Cannot delete trigger used by a CHECK Constraint",
      "335544542": "Cannot update trigger used by a CHECK Constraint",
      "335544543": "Cannot delete column being used in an Integrity Constraint",
      "335544544": "Cannot rename column being used in an Integrity Constraint",
      "335544545": "Cannot update constraints (RDB$RELATION_CONSTRAINTS)",
      "335544546": "Cannot define constraints on views",
      "335544547": "Internal gds software consistency check (invalid RDB$CONSTRAINT_TYPE)",
      "335544548": "Attempt to define a second PRIMARY KEY for the same table",
      "335544549": "Cannot modify or erase a system trigger",
      "335544550": "Only the owner of a table may reassign ownership",
      "335544551": "Could not find table/procedure for GRANT",
      "335544552": "Could not find column for GRANT",
      "335544553": "User does not have GRANT privileges for operation",
      "335544554": "Table/procedure has non-SQL security class defined",
      "335544555": "Column has non-SQL security class defined",
      "335544556": "Write-ahead Log without shared cache configuration not allowed",
      "335544557": "Database shutdown unsuccessful",
      "335544558": "Operation violates check constraint @1 on view or table @2",
      "335544559": "Invalid service handle",
      "335544560": "Database @1 shutdown in @2 seconds",
      "335544561": "Wrong version of service parameter block",
      "335544562": "Unrecognized service parameter block",
      "335544563": "Service @1 is not defined",
      "335544564": "long-term journaling not enabled",
      "335544565": "Cannot transliterate character between character sets",
      "335544566": "WAL defined; Cache Manager must be started first",
      "335544567": "Overflow log specification required for round-robin log",
      "335544568": "Implementation of text subtype @1 not located",
      "335544569": "Dynamic SQL Error",
      "335544570": "Invalid command",
      "335544571": "Data type for constant unknown",
      "335544572": "Invalid cursor reference",
      "335544573": "Data type unknown",
      "335544574": "Invalid cursor declaration",
      "335544575": "Cursor @1 is not updatable",
      "335544576": "Attempt to reopen an open cursor",
      "335544577": "Attempt to reclose a closed cursor",
      "335544578": "Column unknown",
      "335544579": "Internal error",
      "335544580": "Table unknown",
      "335544581": "Procedure unknown",
      "335544582": "Request unknown",
      "335544583": "SQLDA missing or incorrect version, or incorrect number/type of variables",
      "335544584": "Count of read - write columns does not equal count of values",
      "335544585": "Invalid statement handle",
      "335544586": "Function unknown",
      "335544587": "Column is not a BLOB",
      "335544588": "COLLATION @1 for CHARACTER SET @2 is not defined",
      "335544589": "COLLATION @1 is not valid for specified CHARACTER SET",
      "335544590": "Option specified more than once",
      "335544591": "Unknown transaction option",
      "335544592": "Invalid array reference",
      "335544593": "Array declared with too many dimensions",
      "335544594": "Illegal array dimension range",
      "335544595": "Trigger unknown",
      "335544596": "Subselect illegal in this context",
      "335544597": "Cannot prepare a CREATE DATABASE/SCHEMA statement",
      "335544598": "Must specify column name for view select expression",
      "335544599": "Number of columns does not match select list",
      "335544600": "Only simple column names permitted for VIEW WITH CHECK OPTION",
      "335544601": "No WHERE clause for VIEW WITH CHECK OPTION",
      "335544602": "Only one table allowed for VIEW WITH CHECK OPTION",
      "335544603": "DISTINCT, GROUP or HAVING not permitted for VIEW WITH CHECK OPTION",
      "335544604": "FOREIGN KEY column count does not match PRIMARY KEY",
      "335544605": "No subqueries permitted for VIEW WITH CHECK OPTION",
      "335544606": "Expression evaluation not supported",
      "335544607": "Gen.c: node not supported",
      "335544608": "Unexpected end of command",
      "335544609": "INDEX @1",
      "335544610": "EXCEPTION @1",
      "335544611": "COLUMN @1",
      "335544612": "Token unknown",
      "335544613": "Union not supported",
      "335544614": "Unsupported DSQL construct",
      "335544615": "Column used with aggregate",
      "335544616": "Invalid column reference",
      "335544617": "Invalid ORDER BY clause",
      "335544618": "Return mode by value not allowed for this data type",
      "335544619": "External functions cannot have morethan 10 parametrs",
      "335544620": "Alias @1 conflicts with an alias in the same statement",
      "335544621": "Alias @1 conflicts with a procedure in the same statement",
      "335544622": "Alias @1 conflicts with a table in the same statement",
      "335544623": "Illegal use of keyword VALUE",
      "335544624": "Segment count of 0 defined for index @1",
      "335544625": "A node name is not permitted in a secondary, shadow, cache or log file name",
      "335544626": "TABLE @1",
      "335544627": "PROCEDURE @1",
      "335544628": "Cannot create index @1",
      "335544629": "Write-ahead Log with shadowing configuration not allowed",
      "335544630": "There are @1 dependencies",
      "335544631": "Too many keys defined for index @1",
      "335544632": "Preceding file did not specify length, so @1 must include starting page number",
      "335544633": "Shadow number must be a positive integer",
      "335544634": "Token unknown - line @1, column @2",
      "335544635": "There is no alias or table named @1 at this scope level",
      "335544636": "There is no index @1 for table @2",
      "335544637": "Table @1 is not referenced in plan",
      "335544638": "Table @1 is referenced more than once in plan; use aliases to distinguish",
      "335544639": "Table @1 is referenced in the plan but not the from list",
      "335544640": "Invalid use of CHARACTER SET or COLLATE",
      "335544641": "Specified domain or source column @1 does not exist",
      "335544642": "Index @1 cannot be used in the specified plan",
      "335544643": "The table @1 is referenced twice; use aliases to differentiate",
      "335544644": "Illegal operation when at beginning of stream",
      "335544645": "The current position is on a crack",
      "335544646": "Database or file exists",
      "335544647": "Invalid comparison operator for find operation",
      "335544648": "Connection lost to pipe server",
      "335544649": "Bad checksum",
      "335544650": "Wrong page type",
      "335544651": "Cannot insert because the file is readonly or is on a read only medium",
      "335544652": "Multiple rows in singleton select",
      "335544653": "Cannot attach to password database",
      "335544654": "Cannot start transaction for password database",
      "335544655": "Invalid direction for find operation",
      "335544656": "Variable @1 conflicts with parameter in same procedure",
      "335544657": "Array/BLOB/DATE data types not allowed in arithmetic",
      "335544658": "@1 is not a valid base table of the specified view",
      "335544659": "Table @1 is referenced twice in view; use an alias to distinguish",
      "335544660": "View @1 has more than one base table; use aliases to distinguish",
      "335544661": "Cannot add index, index root page is full",
      "335544662": "BLOB SUB_TYPE @1 is not defined",
      "335544663": "Too many concurrent executions of the same request",
      "335544664": "Duplicate specification of @1- not supported",
      "335544665": 'Violation of PRIMARY or UNIQUE KEY constraint "@1" on table "@2"',
      "335544666": "Server version too old to support all CREATE DATABASE options",
      "335544667": "Drop database completed with errors",
      "335544668": "Procedure @1 does not return any values",
      "335544669": "Count of column list and variable list do not match",
      "335544670": "Attempt to index BLOB column in index @1",
      "335544671": "Attempt to index array column in index @1",
      "335544672": "Too few key columns found for index @1 (incorrect column name?)",
      "335544673": "Cannot delete",
      "335544674": "Last column in a table cannot be deleted",
      "335544675": "Sort error",
      "335544676": "Sort error: not enough memory",
      "335544677": "Too many versions",
      "335544678": "Invalid key position",
      "335544679": "Segments not allowed in expression index @1",
      "335544680": "Sort error: corruption in data structure",
      "335544681": "New record size of @1 bytes is too big",
      "335544682": "Inappropriate self-reference of column",
      "335544683": "Request depth exceeded. (Recursive definition?)",
      "335544684": "Cannot access column @1 in view @2",
      "335544685": "Dbkey not available for multi - table views",
      "335544686": "journal file wrong format",
      "335544687": "intermediate journal file full",
      "335544688": "The prepare statement identifies a prepare statement with an open cursor",
      "335544689": "Firebird error",
      "335544690": "Cache redefined",
      "335544691": "Insufficient memory to allocate page buffer cache",
      "335544692": "Log redefined",
      "335544693": "Log size too small",
      "335544694": "Log partition size too small",
      "335544695": "Partitions not supported in series of log file specification",
      "335544696": "Total length of a partitioned log must be specified",
      "335544697": "Precision must be from 1 to 18",
      "335544698": "Scale must be between zero and precision",
      "335544699": "Short integer expected",
      "335544700": "Long integer expected",
      "335544701": "Unsigned short integer expected",
      "335544702": "Invalid ESCAPE sequence",
      "335544703": "Service @1 does not have an associated executable",
      "335544704": "Failed to locate host machine",
      "335544705": "Undefined service @1/@2",
      "335544706": "The specified name was not found in the hosts file or Domain Name Services",
      "335544707": "User does not have GRANT privileges on base table/view for operation",
      "335544708": "Ambiguous column reference",
      "335544709": "Invalid aggregate reference",
      "335544710": "Navigational stream @1 references a view with more than one base table",
      "335544711": "Attempt to execute an unprepared dynamic SQL statement",
      "335544712": "Positive value expected",
      "335544713": "Incorrect values within SQLDA structure",
      "335544714": "Invalid blob id",
      "335544715": "Operation not supported for EXTERNAL FILE table @1",
      "335544716": "Service is currently busy: @1",
      "335544717": "Stack size insufficent to execute current request",
      "335544718": "Invalid key for find operation",
      "335544719": "Error initializing the network software.",
      "335544720": "Unable to load required library @1.",
      "335544721": 'Unable to complete network request to host "@1"',
      "335544722": "Failed to establish a connection",
      "335544723": "Error while listening for an incoming connection",
      "335544724": "Failed to establish a secondary connection for event processing",
      "335544725": "Error while listening for an incoming event connection request",
      "335544726": "Error reading data from the connection",
      "335544727": "Error writing data to the connection",
      "335544728": "Cannot deactivate index used by an integrity constraint",
      "335544729": "Cannot deactivate index used by a PRIMARY/UNIQUE constraint",
      "335544730": "Client/Server Express not supported in this release",
      "335544731": "[no associated message]",
      "335544732": "Access to databases on file servers is not supported",
      "335544733": "Error while trying to create file",
      "335544734": "Error while trying to open file",
      "335544735": "Error while trying to close file",
      "335544736": "Error while trying to read from file",
      "335544737": "Error while trying to write to file",
      "335544738": "Error while trying to delete file",
      "335544739": "Error while trying to access file",
      "335544740": "A fatal exception occurred during the execution of a user defined function",
      "335544741": "Connection lost to database",
      "335544742": "User cannot write to RDB$USER_PRIVILEGES",
      "335544743": "Token size exceeds limit",
      "335544744": "Maximum user count exceeded.Contact your database administrator",
      "335544745": "Your login @1 is same as one of the SQL role name. Ask your\ndatabase administrator to set up a valid Firebird login.\n",
      "335544746": '"REFERENCES table" without "(column)" requires PRIMARY KEY on referenced table',
      "335544747": "The username entered is too long. Maximum length is 31 bytes",
      "335544748": "The password specified is too long. Maximum length is @1 bytes",
      "335544749": "A username is required for this operation",
      "335544750": "A password is required for this operation",
      "335544751": "The network protocol specified is invalid",
      "335544752": "A duplicate user name was found in the security database",
      "335544753": "The user name specified was not found in the security database",
      "335544754": "An error occurred while attempting to add the user",
      "335544755": "An error occurred while attempting to modify the user record",
      "335544756": "An error occurred while attempting to delete the user record",
      "335544757": "An error occurred while updating the security database",
      "335544758": "Sort record size of @1 bytes is too big ????",
      "335544759": "Can not define a not null column with NULL as default value",
      "335544760": "Invalid clause - '@1'",
      "335544761": "Too many open handles to database",
      "335544762": "size of optimizer block exceeded",
      "335544763": "A string constant is delimited by double quotes",
      "335544764": "DATE must be changed to TIMESTAMP",
      "335544765": "Attempted update on read - only database",
      "335544766": "SQL dialect @1 is not supported in this database",
      "335544767": "A fatal exception occurred during the execution of a blob filter",
      "335544768": "Access violation.The code attempted to access a virtual address without privilege to do so",
      "335544769": "Datatype misalignment.The attempted to read or write a value that was not\nstored on a memory boundary\n",
      "335544770": "Array bounds exceeded. The code attempted to access an array element that is\nout of bounds.\n",
      "335544771": "Float denormal operand.One of the floating-point operands is too small to\nrepresent a standard float value.\n",
      "335544772": "Floating-point divide by zero.The code attempted to divide a floating-point\nvalue by zero.\n",
      "335544773": "Floating-point inexact result.The result of a floating-point operation cannot\nbe represented as a decimal fraction\n",
      "335544774": "Floating-point invalid operand.An indeterminant error occurred during a\nfloating-point operation\n",
      "335544775": "Floating-point overflow.The exponent of a floating-point operation is\ngreater than the magnitude allowed\n",
      "335544776": "Floating-point stack check.The stack overflowed or underflowed as the\nresult of a floating-point operation\n",
      "335544777": "Floating-point underflow.The exponent of a floating-point operation is\nless than the magnitude allowed\n",
      "335544778": "Integer divide by zero.The code attempted to divide an integer value by\nan integer divisor of zero\n",
      "335544779": "Integer overflow.The result of an integer operation caused the most\nsignificant bit of the result to carry\n",
      "335544780": "An exception occurred that does not have a description.Exception number @1",
      "335544781": "Stack overflow.The resource requirements of the runtime stack have exceeded\nthe memory available to it\n",
      "335544782": "Segmentation Fault. The code attempted to access memory without privileges",
      "335544783": "Illegal Instruction. The Code attempted to perfrom an illegal operation",
      "335544784": "Bus Error. The Code caused a system bus error",
      "335544785": "Floating Point Error. The Code caused an Arithmetic Exception\nor a floating point exception\n",
      "335544786": "Cannot delete rows from external files",
      "335544787": "Cannot update rows in external files",
      "335544788": "Unable to perform operation.You must be either SYSDBA or\nowner of the database\n",
      "335544789": "Specified EXTRACT part does not exist in input datatype",
      "335544790": "Service @1 requires SYSDBA permissions. Reattach to the Service Manager using the SYSDBA account",
      "335544791": "The file @1 is currently in use by another process.Try again later",
      "335544792": "Cannot attach to services manager",
      "335544793": "Metadata update statement is not allowed by the current database SQL dialect @1",
      "335544794": "Operation was cancelled",
      "335544795": "Unexpected item in service parameter block, expected @1",
      "335544796": "Client SQL dialect @1 does not support reference to @2 datatype",
      "335544797": "User name and password are required while attaching to\nthe services manager\n",
      "335544798": "You created an indirect dependency on uncommitted metadata. You must\nroll back the current transaction\n",
      "335544799": "The service name was not specified",
      "335544800": "Too many Contexts of Relation/Procedure/Views. Maximum allowed is 255",
      "335544801": "Data type not supported for arithmetic",
      "335544802": "Database dialect being changed from 3 to 1",
      "335544803": "Database dialect not changed",
      "335544804": "Unable to create database @1",
      "335544805": "Database dialect @1 is not a valid dialect",
      "335544806": "Valid database dialects are @1",
      "335544807": "SQL warning code = @1",
      "335544808": "DATE data type is now called TIMESTAMP",
      "335544809": "Function @1 is in @2, which is not in a permitted directory for\nexternal functions\n",
      "335544810": "Value exceeds the range for valid dates",
      "335544811": "Passed client dialect @1 is not a valid dialect",
      "335544812": "Valid client dialects are @1",
      "335544813": "Unsupported field type specified in BETWEEN predicate",
      "335544814": "Services functionality will be supported in a later version\nof the product\n",
      "335544815": "GENERATOR @1",
      "335544816": "UDF @1",
      "335544817": "Invalid parameter to FIRST.Only integers >= 0 are allowed",
      "335544818": "Invalid parameter to SKIP. Only integers >= 0 are allowed",
      "335544819": "File exceeded maximum size of 2GB. Add another database file or use\na 64 bit I/O version of Firebird\n",
      "335544820": "Unable to find savepoint with name @1 in transaction context",
      "335544821": "Invalid column position used in the @1 clause",
      "335544822": "Cannot use an aggregate function in a WHERE clause, use HAVING instead",
      "335544823": "Cannot use an aggregate function in a GROUP BY clause",
      "335544824": "Invalid expression in the @1 (not contained in either an aggregate function or the GROUP BY clause)",
      "335544825": "Invalid expression in the @1 (neither an aggregate function nor a part of the GROUP BY clause)",
      "335544826": "Nested aggregate functions are not allowed",
      "335544827": "Invalid argument in EXECUTE STATEMENT-cannot convert to string",
      "335544828": "Wrong request type in EXECUTE STATEMENT '@1'",
      "335544829": "Variable type (position @1) in EXECUTE STATEMENT '@2' INTO does not\nmatch returned column type\n",
      "335544830": "Too many recursion levels of EXECUTE STATEMENT",
      "335544831": 'Access to @1 "@2" is denied by server administrator',
      "335544832": "Cannot change difference file name while database is in backup mode",
      "335544833": "Physical backup is not allowed while Write-Ahead Log is in use",
      "335544834": "Cursor is not open",
      "335544835": 'Target shutdown mode is invalid for database "@1"',
      "335544836": "Concatenation overflow. Resulting string cannot exceed 32K in length",
      "335544837": "Invalid offset parameter @1 to SUBSTRING. Only positive integers are allowed",
      "335544838": "Foreign key reference target does not exist",
      "335544839": "Foreign key references are present for the record",
      "335544840": "Cannot update",
      "335544841": "Cursor is already open",
      "335544842": "@1",
      "335544843": "Context variable @1 is not found in namespace @2",
      "335544844": "Invalid namespace name @1 passed to @2",
      "335544845": "Too many context variables",
      "335544846": "Invalid argument passed to @1",
      "335544847": "BLR syntax error. Identifier @1... is too long",
      "335544848": "Exception @1",
      "335544849": "Malformed string",
      "335544850": "Output parameter mismatch for procedure @1",
      "335544851": "Unexpected end of command- line @1, column @2",
      "335544852": "Partner index segment no @1 has incompatible data type",
      "335544853": "Invalid length parameter @1 to SUBSTRING. Negative integers are not allowed",
      "335544854": "CHARACTER SET @1 is not installed",
      "335544855": "COLLATION @1 for CHARACTER SET @2 is not installed",
      "335544856": "Connection shutdown",
      "335544857": "Maximum BLOB size exceeded",
      "335544858": "Can't have relation with only computed fields or constraints",
      "335544859": "Time precision exceeds allowed range (0-@1)",
      "335544860": "Unsupported conversion to target type BLOB (subtype @1)",
      "335544861": "Unsupported conversion to target type ARRAY",
      "335544862": "Stream does not support record locking",
      "335544863": "Cannot create foreign key constraint @1. Partner index does not\nexist or is inactive\n",
      "335544864": "Transactions count exceeded. Perform backup and restore to make\ndatabase operable again\n",
      "335544865": "Column has been unexpectedly deleted",
      "335544866": "@1 cannot depend on @2",
      "335544867": "Blob sub_types bigger than 1 (text) are for internal use only",
      "335544868": "Procedure @1 is not selectable (it does not contain a SUSPEND\nstatement)\n",
      "335544869": "Datatype @1 is not supported for sorting operation",
      "335544870": "COLLATION @1",
      "335544871": "DOMAIN @1",
      "335544872": "Domain @1 is not defined",
      "335544873": "Array data type can use up to @1 dimensions",
      "335544874": "A multi database transaction cannot span more than @1 databases",
      "335544875": "Bad debug info format",
      "335544876": "Error while parsing procedure @1' s BLR",
      "335544877": "Index key too big",
      "335544878": "Concurrent transaction number is @1",
      "335544879": 'Validation error for variable @1, value "@2"',
      "335544880": 'Validation error for @1, value "@2"',
      "335544881": "Difference file name should be set explicitly for database on raw device",
      "335544882": "Login name too long (@1 characters, maximum allowed @2)",
      "335544883": "Column @1 is not defined in procedure @2",
      "335544884": "Invalid SIMILAR TO pattern",
      "335544885": "Invalid TEB format",
      "335544886": "Found more than one transaction isolation in TPB",
      "335544887": "Table reservation lock type @1 requires table name before in TPB",
      "335544888": "Found more than one @1 specification in TPB",
      "335544889": "Option @1 requires READ COMMITTED isolation in TPB",
      "335544890": "Option @1 is not valid if @2 was used previously in TPB",
      "335544891": "Table name length missing after table reservation @1 in TPB",
      "335544892": "Table name length @1 is too long after table reservation @2 in TPB",
      "335544893": "Table name length @1 without table name after table reservation @2 in TPB",
      "335544894": "Table name length @1 goes beyond the remaining TPB size after table reservation @2",
      "335544895": "Table name length is zero after table reservation @1 in TPB",
      "335544896": "Table or view @1 not defined in system tables after table reservation @2 in TPB",
      "335544897": "Base table or view @1 for view @2 not defined in system tables after table reservation @3 in TPB",
      "335544898": "Option length missing after option @1 in TPB",
      "335544899": "Option length @1 without value after option @2 in TPB",
      "335544900": "Option length @1 goes beyond the remaining TPB size after option @2",
      "335544901": "Option length is zero after table reservation @1 in TPB",
      "335544902": "Option length @1 exceeds the range for option @2 in TPB",
      "335544903": "Option value @1 is invalid for the option @2 in TPB",
      "335544904": "Preserving previous table reservation @1 for table @2, stronger than new @3 in TPB",
      "335544905": "Table reservation @1 for table @2 already specified and is stronger than new @3 in TPB",
      "335544906": "Table reservation reached maximum recursion of @1 when expanding views in TPB",
      "335544907": "Table reservation in TPB cannot be applied to @1 because it\u2019s a virtual table",
      "335544908": "Table reservation in TPB cannot be applied to @1 because it\u2019s a system table",
      "335544909": "Table reservation @1 or @2 in TPB cannot be applied to @3 because it\u2019s a temporary table",
      "335544910": "Cannot set the transaction in read only mode after a table reservation isc_tpb_lock_write in TPB",
      "335544911": "Cannot take a table reservation isc_tpb_lock_write in TPB because the transaction is in read only mode",
      "335544912": "value exceeds the range for a valid time",
      "335544913": "value exceeds the range for valid timestamps",
      "335544914": "string right truncation",
      "335544915": "blob truncation when converting to a string: length limit exceeded",
      "335544916": "numeric value is out of range",
      "335544917": "Firebird shutdown is still in progress after the specified timeout",
      "335544918": "Attachment handle is busy",
      "335544919": "Bad written UDF detected: pointer returned in FREE_IT function was not allocated by ib_util_malloc",
      "335544920": "External Data Source provider '@1' not found",
      "335544921": "Execute statement error at @1 :\n@2Data source : @3",
      "335544922": "Execute statement preprocess SQL error",
      "335544923": "Statement expected",
      "335544924": "Parameter name expected",
      "335544925": "Unclosed comment found near '@1'",
      "335544926": "Execute statement error at @1 :\n@2Statement : @3\nData source : @4",
      "335544927": "Input parameters mismatch",
      "335544928": "Output parameters mismatch",
      "335544929": "Input parameter '@1' have no value set",
      "335544930": "BLR stream length @1 exceeds implementation limit @2",
      "335544931": "Monitoring table space exhausted",
      "335544932": "module name or entrypoint could not be found",
      "335544933": "nothing to cancel",
      "335544934": "ib_util library has not been loaded to deallocate memory returned by FREE_IT function",
      "335544935": "Cannot have circular dependencies with computed fields",
      "335544936": "Security database error",
      "335544937": "Invalid data type in DATE/TIME/TIMESTAMP addition or subtraction in add_datettime()",
      "335544938": "Only a TIME value can be added to a DATE value",
      "335544939": "Only a DATE value can be added to a TIME value",
      "335544940": "TIMESTAMP values can be subtracted only from another TIMESTAMP value",
      "335544941": "Only one operand can be of type TIMESTAMP",
      "335544942": "Only HOUR, MINUTE, SECOND and MILLISECOND can be extracted from TIME values",
      "335544943": "HOUR, MINUTE, SECOND and MILLISECOND cannot be extracted from DATE values",
      "335544944": "Invalid argument for EXTRACT() not being of DATE/TIME/TIMESTAMP type",
      "335544945": "Arguments for @1 must be integral types or NUMERIC/DECIMAL without scale",
      "335544946": "First argument for @1 must be integral type or floating point type",
      "335544947": "Human readable UUID argument for @1 must be of string type",
      "335544948": "Human readable UUID argument for @2 must be of exact length @1",
      "335544949": 'Human readable UUID argument for @3 must have "-" at position @2 instead of "@1"',
      "335544950": 'Human readable UUID argument for @3 must have hex digit at position @2 instead of "@1"',
      "335544951": "Only HOUR, MINUTE, SECOND and MILLISECOND can be added to TIME values in @1",
      "335544952": "Invalid data type in addition of part to DATE/TIME/TIMESTAMP in @1",
      "335544953": "Invalid part @1 to be added to a DATE/TIME/TIMESTAMP value in @2",
      "335544954": "Expected DATE/TIME/TIMESTAMP type in evlDateAdd() result",
      "335544955": "Expected DATE/TIME/TIMESTAMP type as first and second argument to @1",
      "335544956": "The result of TIME-<value> in @1 cannot be expressed in YEAR, MONTH, DAY or WEEK",
      "335544957": "The result of TIME-TIMESTAMP or TIMESTAMP-TIME in @1 cannot be expressed in HOUR, MINUTE, SECOND or MILLISECOND",
      "335544958": "The result of DATE-TIME or TIME-DATE in @1 cannot be expressed in HOUR, MINUTE, SECOND and MILLISECOND",
      "335544959": "Invalid part @1 to express the difference between two DATE/TIME/TIMESTAMP values in @2",
      "335544960": "Argument for @1 must be positive",
      "335544961": "Base for @1 must be positive",
      "335544962": "Argument #@1 for @2 must be zero or positive",
      "335544963": "Argument #@1 for @2 must be positive",
      "335544964": "Base for @1 cannot be zero if exponent is negative",
      "335544965": "Base for @1 cannot be negative if exponent is not an integral value",
      "335544966": "The numeric scale must be between -128 and 127 in @1",
      "335544967": "Argument for @1 must be zero or positive",
      "335544968": "Binary UUID argument for @1 must be of string type",
      "335544969": "Binary UUID argument for @2 must use @1 bytes",
      "335544970": "Missing required item @1 in service parameter block",
      "335544971": "@1 server is shutdown",
      "335544972": "Invalid connection string",
      "335544973": "Unrecognized events block",
      "335544974": "Could not start first worker thread - shutdown server",
      "335544975": "Timeout occurred while waiting for a secondary connection for event processing",
      "335544976": "Argument for @1 must be different than zero",
      "335544977": "Argument for @1 must be in the range [-1, 1]",
      "335544978": "Argument for @1 must be greater or equal than one",
      "335544979": "Argument for @1 must be in the range ]-1, 1[",
      "335544980": "Incorrect parameters provided to internal function @1",
      "335544981": "Floating point overflow in built-in function @1",
      "335544982": "Floating point overflow in result from UDF @1",
      "335544983": "Invalid floating point value returned by UDF @1",
      "335544984": "Database is probably already opened by another engine instance in another Windows session",
      "335544985": "No free space found in temporary directories",
      "335544986": "Explicit transaction control is not allowed",
      "335544987": "Use of TRUSTED switches in spb_command_line is prohibited",
      "335544988": "PACKAGE @1",
      "335544989": "Cannot make field @1 of table @2 NOT NULL because there are NULLs present",
      "335544990": "Feature @1 is not supported anymore",
      "335544991": "VIEW @1",
      "335544992": "Can not access lock files directory @1",
      "335544993": "Fetch option @1 is invalid for a non-scrollable cursor",
      "335544994": "Error while parsing function @1\u2019s BLR",
      "335544995": "Cannot execute function @1 of the unimplemented package @2",
      "335544996": "Cannot execute procedure @1 of the unimplemented package @2",
      "335544997": "External function @1 not returned by the external engine plugin @2",
      "335544998": "External procedure @1 not returned by the external engine plugin @2",
      "335544999": "External trigger @1 not returned by the external engine plugin @2",
      "335545000": "Incompatible plugin version @1 for external engine @2",
      "335545001": "External engine @1 not found",
      "335545002": "Attachment is in use",
      "335545003": "Transaction is in use",
      "335545004": "Error loading plugin @1",
      "335545005": "Loadable module @1 not found",
      "335545006": "Standard plugin entrypoint does not exist in module @1",
      "335545007": "Module @1 exists but can not be loaded",
      "335545008": "Module @1 does not contain plugin @2 type @3",
      "335545009": "Invalid usage of context namespace DDL_TRIGGER",
      "335545010": "Value is NULL but isNull parameter was not informed",
      "335545011": "Type @1 is incompatible with BLOB",
      "335545012": "Invalid date",
      "335545013": "Invalid time",
      "335545014": "Invalid timestamp",
      "335545015": "Invalid index @1 in function @2",
      "335545016": "@1",
      "335545017": "Asynchronous call is already running for this attachment",
      "335545018": "Function @1 is private to package @2",
      "335545019": "Procedure @1 is private to package @2",
      "335545020": "Request can\u2019t access new records in relation @1 and should be recompiled",
      "335545021": "invalid events id (handle)",
      "335545022": "Cannot copy statement @1",
      "335545023": "Invalid usage of boolean expression",
      "335545024": "Arguments for @1 cannot both be zero",
      "335545025": "missing service ID in spb",
      "335545026": "External BLR message mismatch: invalid null descriptor at field @1",
      "335545027": "External BLR message mismatch: length = @1, expected @2",
      "335545028": "Subscript @1 out of bounds [@2, @3]",
      "335545029": "Install incomplete. To complete security database initialization please CREATE USER. For details read doc/README.security_database.txt.",
      "335545030": "@1 operation is not allowed for system table @2",
      "335545031": "Libtommath error code @1 in function @2",
      "335545032": "unsupported BLR version (expected between @1 and @2, encountered @3)",
      "335545033": "expected length @1, actual @2",
      "335545034": "Wrong info requested in isc_svc_query() for anonymous service",
      "335545035": "No isc_info_svc_stdin in user request, but service thread requested stdin data",
      "335545036": "Start request for anonymous service is impossible",
      "335545037": "All services except for getting server log require switches",
      "335545038": "Size of stdin data is more than was requested from client",
      "335545039": "Crypt plugin @1 failed to load",
      "335545040": "Length of crypt plugin name should not exceed @1 bytes",
      "335545041": "Crypt failed - already crypting database",
      "335545042": "Crypt failed - database is already in requested state",
      "335545043": "Missing crypt plugin, but page appears encrypted",
      "335545044": "No providers loaded",
      "335545045": "NULL data with non-zero SPB length",
      "335545046": "Maximum (@1) number of arguments exceeded for function @2",
      "335545047": "External BLR message mismatch: names count = @1, blr count = @2",
      "335545048": "External BLR message mismatch: name @1 not found",
      "335545049": "Invalid resultset interface",
      "335545050": "Message length passed from user application does not match set of columns",
      "335545051": "Resultset is missing output format information",
      "335545052": "Message metadata not ready - item @1 is not finished",
      "335545053": "Missing configuration file: @1",
      "335545054": "@1: illegal line <@2>",
      "335545055": "Invalid include operator in @1 for <@2>",
      "335545056": "Include depth too big",
      "335545057": "File to include not found",
      "335545058": "Only the owner can change the ownership",
      "335545059": "undefined variable number",
      "335545060": "Missing security context for @1",
      "335545061": "Missing segment @1 in multisegment connect block parameter",
      "335545062": "Different logins in connect and attach packets - client library error",
      "335545063": "Exceeded exchange limit during authentication handshake",
      "335545064": "Incompatible wire encryption levels requested on client and server",
      "335545065": "Client attempted to attach unencrypted but wire encryption is required",
      "335545066": "Client attempted to start wire encryption using unknown key @1",
      "335545067": "Client attempted to start wire encryption using unsupported plugin @1",
      "335545068": "Error getting security database name from configuration file",
      "335545069": "Client authentication plugin is missing required data from server",
      "335545070": "Client authentication plugin expected @2 bytes of @3 from server, got @1",
      "335545071": "Attempt to get information about an unprepared dynamic SQL statement.",
      "335545072": "Problematic key value is @1",
      "335545073": "Cannot select virtual table @1 for update WITH LOCK",
      "335545074": "Cannot select system table @1 for update WITH LOCK",
      "335545075": "Cannot select temporary table @1 for update WITH LOCK",
      "335545076": "System @1 @2 cannot be modified",
      "335545077": "Server misconfigured - contact administrator please",
      "335545078": "Deprecated backward compatibility ALTER ROLE \u2026\u200B SET/DROP AUTO ADMIN mapping may be used only for RDB$ADMIN role",
      "335545079": "Mapping @1 already exists",
      "335545080": "Mapping @1 does not exist",
      "335545081": "@1 failed when loading mapping cache",
      "335545082": "Invalid name <*> in authentication block",
      "335545083": "Multiple maps found for @1",
      "335545084": "Undefined mapping result - more than one different results found",
      "335545085": "Incompatible mode of attachment to damaged database",
      "335545086": "Attempt to set in database number of buffers which is out of acceptable range [@1:@2]",
      "335545087": "Attempt to temporarily set number of buffers less than @1",
      "335545088": "Global mapping is not available when database @1 is not present",
      "335545089": "Global mapping is not available when table RDB$MAP is not present in database @1",
      "335545090": "Your attachment has no trusted role",
      "335545091": "Role @1 is invalid or unavailable",
      "335545092": "Cursor @1 is not positioned in a valid record",
      "335545093": "Duplicated user attribute @1",
      "335545094": "There is no privilege for this operation",
      "335545095": "Using GRANT OPTION on @1 not allowed",
      "335545096": "read conflicts with concurrent update",
      "335545097": "@1 failed when working with CREATE DATABASE grants",
      "335545098": "CREATE DATABASE grants check is not possible when database @1 is not present",
      "335545099": "CREATE DATABASE grants check is not possible when table RDB$DB_CREATORS is not present in database @1",
      "335545100": "Interface @3 version too old: expected @1, found @2",
      "335545101": "Input parameter mismatch for function @1",
      "335545102": "Error during savepoint backout - transaction invalidated",
      "335545103": "Domain used in the PRIMARY KEY constraint of table @1 must be NOT NULL",
      "335545104": "CHARACTER SET @1 cannot be used as a attachment character set",
      "335545105": "Some database(s) were shutdown when trying to read mapping data",
      "335545106": "Error occurred during login, please check server firebird.log for details",
      "335545107": "Database already opened with engine instance, incompatible with current",
      "335545108": "Invalid crypt key @1",
      "335545109": "Page requires encryption but crypt plugin is missing",
      "335545110": "Maximum index depth (@1 levels) is reached",
      "335545111": "System privilege @1 does not exist",
      "335545112": "System privilege @1 is missing",
      "335545113": "Invalid or missing checksum of encrypted database",
      "335545114": "You must have SYSDBA rights at this server",
      "335545115": "Cannot open cursor for non-SELECT statement",
      "335545116": "If <window frame bound 1> specifies @1, then <window frame bound 2> shall not specify @2",
      "335545117": "RANGE based window with <expr> {PRECEDING | FOLLOWING} cannot have ORDER BY with more than one value",
      "335545118": "RANGE based window must have an ORDER BY key of numerical, date, time or timestamp types",
      "335545119": "Window RANGE/ROWS PRECEDING/FOLLOWING value must be of a numerical type",
      "335545120": "Invalid PRECEDING or FOLLOWING offset in window function: cannot be negative",
      "335545121": "Window @1 not found",
      "335545122": "Cannot use PARTITION BY clause while overriding the window @1",
      "335545123": "Cannot use ORDER BY clause while overriding the window @1 which already has an ORDER BY clause",
      "335545124": "Cannot override the window @1 because it has a frame clause. Tip: it can be used without parenthesis in OVER",
      "335545125": "Duplicate window definition for @1",
      "335545126": "SQL statement is too long. Maximum size is @1 bytes.",
      "335545127": "Config level timeout expired.",
      "335545128": "Attachment level timeout expired.",
      "335545129": "Statement level timeout expired.",
      "335545130": "Killed by database administrator.",
      "335545131": "Idle timeout expired.",
      "335545132": "Database is shutdown.",
      "335545133": "Engine is shutdown.",
      "335545134": "OVERRIDING clause can be used only when an identity column is present in the INSERT\u2019s field list for table/view @1",
      "335545135": "OVERRIDING SYSTEM VALUE can be used only for identity column defined as 'GENERATED ALWAYS' in INSERT for table/view @1",
      "335545136": "OVERRIDING USER VALUE can be used only for identity column defined as 'GENERATED BY DEFAULT' in INSERT for table/view @1",
      "335545137": "OVERRIDING SYSTEM VALUE should be used to override the value of an identity column defined as 'GENERATED ALWAYS' in table/view @1",
      "335545138": "DecFloat precision must be 16 or 34",
      "335545139": "Decimal float divide by zero.  The code attempted to divide a DECFLOAT value by zero.",
      "335545140": "Decimal float inexact result.  The result of an operation cannot be represented as a decimal fraction.",
      "335545141": "Decimal float invalid operation.  An indeterminant error occurred during an operation.",
      "335545142": "Decimal float overflow.  The exponent of a result is greater than the magnitude allowed.",
      "335545143": "Decimal float underflow.  The exponent of a result is less than the magnitude allowed.",
      "335545144": "Sub-function @1 has not been defined",
      "335545145": "Sub-procedure @1 has not been defined",
      "335545146": "Sub-function @1 has a signature mismatch with its forward declaration",
      "335545147": "Sub-procedure @1 has a signature mismatch with its forward declaration",
      "335545148": "Default values for parameters are not allowed in definition of the previously declared sub-function @1",
      "335545149": "Default values for parameters are not allowed in definition of the previously declared sub-procedure @1",
      "335545150": "Sub-function @1 was declared but not implemented",
      "335545151": "Sub-procedure @1 was declared but not implemented",
      "335545152": "Invalid HASH algorithm @1",
      "335545153": 'Expression evaluation error for index "@1" on table "@2"',
      "335545154": "Invalid decfloat trap state @1",
      "335545155": "Invalid decfloat rounding mode @1",
      "335545156": "Invalid part @1 to calculate the @1 of a DATE/TIMESTAMP",
      "335545157": "Expected DATE/TIMESTAMP value in @1",
      "335545158": "Precision must be from @1 to @2",
      "335545159": "invalid batch handle",
      "335545160": "Bad international character in tag @1",
      "335545161": "Null data in parameters block with non-zero length",
      "335545162": "Items working with running service and getting generic server information should not be mixed in single info block",
      "335545163": "Unknown information item, code @1",
      "335545164": "Wrong version of blob parameters block @1, should be @2",
      "335545165": "User management plugin is missing or failed to load",
      "335545166": "Missing entrypoint @1 in ICU library",
      "335545167": "Could not find acceptable ICU library",
      "335545168": "Name @1 not found in system MetadataBuilder",
      "335545169": "Parse to tokens error",
      "335545170": "Error opening international conversion descriptor from @1 to @2",
      "335545171": "Message @1 is out of range, only @2 messages in batch",
      "335545172": "Detailed error info for message @1 is missing in batch",
      "335545173": "Compression stream init error @1",
      "335545174": "Decompression stream init error @1",
      "335545175": "Segment size (@1) should not exceed 65535 (64K - 1) when using segmented blob",
      "335545176": "Invalid blob policy in the batch for @1() call",
      "335545177": "Can\u2019t change default BPB after adding any data to batch",
      "335545178": "Unexpected info buffer structure querying for default blob alignment",
      "335545179": "Duplicated segment @1 in multisegment connect block parameter",
      "335545180": "Plugin not supported by network protocol",
      "335545181": "Error parsing message format",
      "335545182": "Wrong version of batch parameters block @1, should be @2",
      "335545183": "Message size (@1) in batch exceeds internal buffer size (@2)",
      "335545184": "Batch already opened for this statement",
      "335545185": "Invalid type of statement used in batch",
      "335545186": "Statement used in batch must have parameters",
      "335545187": "There are no blobs in associated with batch statement",
      "335545188": "appendBlobData() is used to append data to last blob but no such blob was added to the batch",
      "335545189": "Portions of data, passed as blob stream, should have size multiple to the alignment required for blobs",
      "335545190": "Repeated blob id @1 in registerBlob()",
      "335545191": "Blob buffer format error",
      "335545192": "Unusable (too small) data remained in @1 buffer",
      "335545193": "Blob continuation should not contain BPB",
      "335545194": "Size of BPB (@1) greater than remaining data (@2)",
      "335545195": "Size of segment (@1) greater than current BLOB data (@2)",
      "335545196": "Size of segment (@1) greater than available data (@2)",
      "335545197": "Unknown blob ID @1 in the batch message",
      "335545198": "Internal buffer overflow - batch too big",
      "335545199": "Numeric literal too long",
      "335545200": "Error using events in mapping shared memory: @1",
      "335545201": "Global mapping memory overflow",
      "335545202": "Header page overflow - too many clumplets on it",
      "335545203": "No matching client/server authentication plugins configured for execute statement in embedded datasource",
      "335545204": "Missing database encryption key for your attachment",
      "335545205": "Key holder plugin @1 failed to load",
      "335545206": "Cannot reset user session",
      "335545207": "There are open transactions (@1 active)",
      "335545208": "Session was reset with warning(s)",
      "335545209": "Transaction is rolled back due to session reset, all changes are lost",
      "335545210": "Plugin @1:",
      "335545211": "PARAMETER @1",
      "335545212": "Starting page number for file @1 must be @2 or greater",
      "335545213": "Invalid time zone offset: @1 - must use format +/-hours:minutes and be between -14:00 and +14:00",
      "335545214": "Invalid time zone region: @1",
      "335545215": "Invalid time zone ID: @1",
      "335545216": "Wrong base64 text length @1, should be multiple of 4",
      "335545217": "Invalid first parameter datatype - need string or blob",
      "335545218": "Error registering @1 - probably bad tomcrypt library",
      "335545219": "Unknown crypt algorithm @1 in USING clause",
      "335545220": "Should specify mode parameter for symmetric cipher",
      "335545221": "Unknown symmetric crypt mode specified",
      "335545222": "Mode parameter makes no sense for chosen cipher",
      "335545223": "Should specify initialization vector (IV) for chosen cipher and/or mode",
      "335545224": "Initialization vector (IV) makes no sense for chosen cipher and/or mode",
      "335545225": "Invalid counter endianess @1",
      "335545226": "Counter endianess parameter is not used in mode @1",
      "335545227": "Too big counter value @1, maximum @2 can be used",
      "335545228": "Counter length/value parameter is not used with @1 @2",
      "335545229": "Invalid initialization vector (IV) length @1, need @2",
      "335545230": "TomCrypt library error: @1",
      "335545231": "Starting PRNG yarrow",
      "335545232": "Setting up PRNG yarrow",
      "335545233": "Initializing @1 mode",
      "335545234": "Encrypting in @1 mode",
      "335545235": "Decrypting in @1 mode",
      "335545236": "Initializing cipher @1",
      "335545237": "Encrypting using cipher @1",
      "335545238": "Decrypting using cipher @1",
      "335545239": "Setting initialization vector (IV) for @1",
      "335545240": "Invalid initialization vector (IV) length @1, need  8 or 12",
      "335545241": "Encoding @1",
      "335545242": "Decoding @1",
      "335545243": "Importing RSA key",
      "335545244": "Invalid OAEP packet",
      "335545245": "Unknown hash algorithm @1",
      "335545246": "Making RSA key",
      "335545247": "Exporting @1 RSA key",
      "335545248": "RSA-signing data",
      "335545249": "Verifying RSA-signed data",
      "335545250": "Invalid key length @1, need 16 or 32",
      "335545251": "invalid replicator handle",
      "335545252": "Transaction\u2019s base snapshot number does not exist",
      "335545253": "Input parameter '@1' is not used in SQL query text",
      "335545254": "Effective user is @1",
      "335545255": "Invalid time zone bind mode @1",
      "335545256": "Invalid decfloat bind mode @1",
      "335545257": "Invalid hex text length @1, should be multiple of 2",
      "335545258": "Invalid hex digit @1 at position @2",
      "335545259": 'Error processing isc_dpb_set_bind clumplet "@1"',
      "335545260": "The following statement failed: @1",
      "335545261": "Can not convert @1 to @2",
      "335545262": "cannot update old BLOB",
      "335545263": "cannot read from new BLOB",
      "335545264": "No permission for CREATE @1 operation",
      "335545265": "SUSPEND could not be used without RETURNS clause in PROCEDURE or EXECUTE BLOCK",
      "335545266": "String truncated warning due to the following reason",
      "335545267": "Monitoring data does not fit into the field",
      "335545268": "Engine data does not fit into return value of system function",
      "335545269": "Multiple source records cannot match the same target during MERGE",
      "335545270": "RDB$PAGES written by non-system transaction, DB appears to be damaged",
      "335545271": "Replication error",
      "335545272": "Reset of user session failed. Connection is shut down.",
      "335545273": "File size is less than expected",
      "335545274": "Invalid key length @1, need >@2",
      "335740929": "Database file name (@1) already given",
      "335740930": "Invalid switch @1",
      "335740932": "Incompatible switch combination",
      "335740933": "Replay log pathname required",
      "335740934": "Number of page buffers for cache required",
      "335740935": "Numeric value required",
      "335740936": "Positive numeric value required",
      "335740937": "Number of transactions per sweep required",
      "335740940": '"full" or "reserve" required',
      "335740941": "User name required",
      "335740942": "Password required",
      "335740943": "Subsystem name",
      "335740945": "Number of seconds required",
      "335740946": "Numeric value between 0 and 32767 inclusive required",
      "335740947": "Must specify type of shutdown",
      "335740948": "Please retry, specifying an option",
      "335740951": "Please retry, giving a database name",
      "335740991": "Internal block exceeds maximum size",
      "335740992": "Corrupt pool",
      "335740993": "Virtual memory exhausted",
      "335740994": "Bad pool id.",
      "335740995": "Transaction state @1 not in valid range",
      "335741012": "Unexpected end of input",
      "335741018": "Failed to reconnect to a transaction in database @1",
      "335741036": "Transaction description item unknown",
      "335741038": '"read_only" or "read_write" required',
      "335741039": "-sql_dialect | set database dialect n",
      "335741042": "Positive or zero numeric value required",
      "336003074": "Cannot SELECT RDB$DB_KEY from a stored procedure",
      "336003075": "Precision 10 to 18 changed from DOUBLE PRECISION in SQL\ndialect 1 to 64-bit scaled integer in SQL dialect 3\n",
      "336003076": "Use of @1 expression that returns different results in dialect 1 and dialect 3",
      "336003077": "Database SQL dialect @1 does not support reference to @2 datatype",
      "336003079": "DB dialect @1 and client dialect @2 conflict with respect to numeric precision @3",
      "336003080": "WARNING: Numeric literal @1 is interpreted as a floating-point",
      "336003081": "value in SQL dialect 1, but as an exact numeric value in SQL dialect 3.",
      "336003082": "WARNING: NUMERIC and DECIMAL fields with precision 10 or greater are stored",
      "336003083": "as approximate floating-point values in SQL dialect 1, but as 64-bit",
      "336003084": "integers in SQL dialect 3.",
      "336003085": "Ambiguous field name between @1 and @2",
      "336003086": "External function should have return position between 1 and @1",
      "336003087": "Label @1 @2 in the current scope",
      "336003088": "Datatypes @1are not comparable in expression @2",
      "336003089": "Empty cursor name is not allowed",
      "336003090": "Statement already has a cursor @1 assigned",
      "336003091": "Cursor @1 is not found in the current context",
      "336003092": "Cursor @1 already exists in the current context",
      "336003093": "Relation @1 is ambiguous in cursor @2",
      "336003094": "Relation @1 is not found in cursor @2",
      "336003095": "Cursor is not open",
      "336003096": "Data type @1 is not supported for EXTERNAL TABLES. Relation '@2', field '@3'",
      "336003097": "Feature not supported on ODS version older than @1.@2",
      "336003098": "Primary key required on table @1",
      "336003099": "UPDATE OR INSERT field list does not match primary key of table @1",
      "336003100": "UPDATE OR INSERT field list does not match MATCHING clause",
      "336003101": "UPDATE OR INSERT without MATCHING could not be used with views based on more than one table",
      "336003102": "Incompatible trigger type",
      "336003103": "Database trigger type can't be changed",
      "336003104": "To be used with RDB$RECORD_VERSION, @1 must be a table or a view of single table",
      "336003105": "SQLDA version expected between @1 and @2, found @3",
      "336003106": "at SQLVAR index @1",
      "336003107": "empty pointer to NULL indicator variable",
      "336003108": "empty pointer to data",
      "336003109": "No SQLDA for input values provided",
      "336003110": "No SQLDA for output values provided",
      "336003111": "Wrong number of parameters (expected @1, got @2)",
      "336003112": "Invalid DROP SQL SECURITY clause",
      "336003113": "UPDATE OR INSERT value for field @1, part of the implicit or explicit MATCHING clause, cannot be DEFAULT",
      "336068645": "BLOB Filter @1 not found",
      "336068649": "Function @1 not found",
      "336068656": "Index not found",
      "336068662": "View @1 not found",
      "336068697": "Domain not found",
      "336068717": "Triggers created automatically cannot be modified",
      "336068740": "Table @1 already exists",
      "336068748": "Procedure @1 not found",
      "336068752": "Exception not found",
      "336068754": "Parameter @1 in procedure @2 not found",
      "336068755": "Trigger @1 not found",
      "336068759": "Character set @1 not found",
      "336068760": "Collation @1 not found",
      "336068763": "Role @1 not found",
      "336068767": "Name longer than database column size",
      "336068784": "column @1 does not exist in table/view @2",
      "336068796": "SQL role @1 does not exist",
      "336068797": "User @1 has no grant admin option on SQL role @2",
      "336068798": "User @1 is not a member of SQL role @2",
      "336068799": "@1 is not the owner of SQL role @2",
      "336068800": "@1 is a SQL role and not a user",
      "336068801": "User name @1 could not be used for SQL role",
      "336068802": "SQL role @1 already exists",
      "336068803": "Keyword @1 can not be used as a SQL role name",
      "336068804": "SQL roles are not supported in on older versions of the database. A backup and restore of the database is required",
      "336068812": "Cannot rename domain @1 to @2. A domain with that name already exists",
      "336068813": "Cannot rename column @1 to @2.A column with that name already exists in table @3",
      "336068814": "Column @1 from table @2 is referenced in @3",
      "336068815": "Cannot change datatype for column @1.Changing datatype is not supported for BLOB or ARRAY columns",
      "336068816": "New size specified for column @1 must be at least @2 characters",
      "336068817": "Cannot change datatype for @1.Conversion from base type @2 to @3 is not supported",
      "336068818": "Cannot change datatype for column @1 from a character type to a non-character type",
      "336068820": "Zero length identifiers are not allowed",
      "336068822": "Sequence @1 not found",
      "336068829": "Maximum number of collations per character set exceeded",
      "336068830": "Invalid collation attributes",
      "336068840": "@1 cannot reference @2",
      "336068843": "Collation @1 is used in table @2 (field name @3) and cannot be dropped",
      "336068844": "Collation @1 is used in domain @2 and cannot be dropped",
      "336068845": "Cannot delete system collation",
      "336068846": "Cannot delete default collation of CHARACTER SET @1",
      "336068849": "Table @1 not found",
      "336068851": "Collation @1 is used in procedure @2 (parameter name @3) and cannot be dropped",
      "336068852": "New scale specified for column @1 must be at most @2",
      "336068853": "New precision specified for column @1 must be at least @2",
      "336068855": "Warning: @1 on @2 is not granted to @3.",
      "336068856": "Feature '@1' is not supported in ODS @2.@3",
      "336068857": "Cannot add or remove COMPUTED from column @1",
      "336068858": "Password should not be empty string",
      "336068859": "Index @1 already exists",
      "336068864": "Package @1 not found",
      "336068865": "Schema @1 not found",
      "336068866": "Cannot ALTER or DROP system procedure @1",
      "336068867": "Cannot ALTER or DROP system trigger @1",
      "336068868": "Cannot ALTER or DROP system function @1",
      "336068869": "Invalid DDL statement for procedure @1",
      "336068870": "Invalid DDL statement for trigger @1",
      "336068871": "Function @1 has not been defined on the package body @2",
      "336068872": "Procedure @1 has not been defined on the package body @2",
      "336068873": "Function @1 has a signature mismatch on package body @2",
      "336068874": "Procedure @1 has a signature mismatch on package body @2",
      "336068875": "Default values for parameters are not allowed in the definition of a previously declared packaged procedure @1.@2",
      "336068877": "Package body @1 already exists",
      "336068878": "Invalid DDL statement for function @1",
      "336068879": "Cannot alter new style function @1 with ALTER EXTERNAL FUNCTION. Use ALTER FUNCTION instead.",
      "336068886": "Parameter @1 in function @2 not found",
      "336068887": "Parameter @1 of routine @2 not found",
      "336068888": "Parameter @1 of routine @2 is ambiguous (found in both procedures and functions). Use a specifier keyword.",
      "336068889": "Collation @1 is used in function @2 (parameter name @3) and cannot be dropped",
      "336068890": "Domain @1 is used in function @2 (parameter name @3) and cannot be dropped",
      "336068891": "ALTER USER requires at least one clause to be specified",
      "336068894": "Duplicate @1 @2",
      "336068895": "System @1 @2 cannot be modified",
      "336068896": "INCREMENT BY 0 is an illegal option for sequence @1",
      "336068897": "Can\u2019t use @1 in FOREIGN KEY constraint",
      "336068898": "Default values for parameters are not allowed in the definition of a previously declared packaged function @1.@2",
      "336068900": "role @1 can not be granted to role @2",
      "336068904": "INCREMENT BY 0 is an illegal option for identity column @1 of table @2",
      "336068907": "no @1 privilege with grant option on DDL @2",
      "336068908": "no @1 privilege with grant option on object @2",
      "336068909": "Function @1 does not exist",
      "336068910": "Procedure @1 does not exist",
      "336068911": "Package @1 does not exist",
      "336068912": "Trigger @1 does not exist",
      "336068913": "View @1 does not exist",
      "336068914": "Table @1 does not exist",
      "336068915": "Exception @1 does not exist",
      "336068916": "Generator/Sequence @1 does not exist",
      "336068917": "Field @1 of table @2 does not exist",
      "336330753": "Found unknown switch",
      "336330754": "Page size parameter missing",
      "336330755": "Page size specified (@1) greater than limit (16384 bytes)",
      "336330756": "Redirect location for output is not specified",
      "336330757": "Conflicting switches for backup/restore",
      "336330758": "Device type @1 not known",
      "336330759": "Protection is not there yet",
      "336330760": "Page size is allowed only on restore or create",
      "336330761": "Multiple sources or destinations specified",
      "336330762": "Requires both input and output filenames",
      "336330763": "Input and output have the same name. Disallowed",
      "336330764": 'Expected page size, encountered "@1"',
      "336330765": "REPLACE specified, but the first file @1 is a database",
      "336330766": "Database @1 already exists.To replace it, use the -REP switch",
      "336330767": "Device type not specified",
      "336330772": "Gds_$blob_info failed",
      "336330773": "Do not understand BLOB INFO item @1",
      "336330774": "Gds_$get_segment failed",
      "336330775": "Gds_$close_blob failed",
      "336330776": "Gds_$open_blob failed",
      "336330777": "Failed in put_blr_gen_id",
      "336330778": "Data type @1 not understood",
      "336330779": "Gds_$compile_request failed",
      "336330780": "Gds_$start_request failed",
      "336330781": "gds_$receive failed",
      "336330782": "Gds_$release_request failed",
      "336330783": "gds_$database_info failed",
      "336330784": "Expected database description record",
      "336330785": "Failed to create database @1",
      "336330786": "RESTORE: decompression length error",
      "336330787": "Cannot find table @1",
      "336330788": "Cannot find column for BLOB",
      "336330789": "Gds_$create_blob failed",
      "336330790": "Gds_$put_segment failed",
      "336330791": "Expected record length",
      "336330792": "Wrong length record, expected @1 encountered @2",
      "336330793": "Expected data attribute",
      "336330794": "Failed in store_blr_gen_id",
      "336330795": "Do not recognize record type @1",
      "336330796": "Expected backup version 1..8. Found @1",
      "336330797": "Expected backup description record",
      "336330798": "String truncated",
      "336330799": "warning -- record could not be restored",
      "336330800": "Gds_$send failed",
      "336330801": "No table name for data",
      "336330802": "Unexpected end of file on backup file",
      "336330803": "Database format @1 is too old to restore to",
      "336330804": "Array dimension for column @1 is invalid",
      "336330807": "Expected XDR record length",
      "336330817": "Cannot open backup file @1",
      "336330818": "Cannot open status and error output file @1",
      "336330934": "Blocking factor parameter missing",
      "336330935": 'Expected blocking factor, encountered "@1"',
      "336330936": "A blocking factor may not be used in conjunction with device CT",
      "336330940": "User name parameter missing",
      "336330941": "Password parameter missing",
      "336330952": "missing parameter for the number of bytes to be skipped",
      "336330953": 'Expected number of bytes to be skipped, encountered "@1"',
      "336330965": "Character set",
      "336330967": "Collation",
      "336330972": "Unexpected I/O error while reading from backup file",
      "336330973": "Unexpected I/O error while writing to backup file",
      "336330985": "Could not drop database @1 (database might be in use)",
      "336330990": "System memory exhausted",
      "336331002": "SQL role",
      "336331005": "SQL role parameter missing",
      "336331010": "Page buffers parameter missing",
      "336331011": 'Expected page buffers, encountered "@1"',
      "336331012": "Page buffers is allowed only on restore or create",
      "336331014": "Size specification either missing or incorrect for file @1",
      "336331015": "File @1 out of sequence",
      "336331016": "Can't join - one of the files missing",
      "336331017": "standard input is not supported when using join operation",
      "336331018": "Standard output is not supported when using split operation",
      "336331019": "Backup file @1 might be corrupt",
      "336331020": "Database file specification missing",
      "336331021": "Can't write a header record to file @1",
      "336331022": "Free disk space exhausted",
      "336331023": "File size given (@1) is less than minimum allowed (@2)",
      "336331025": "Service name parameter missing",
      "336331026": "Cannot restore over current database, must be SYSDBA or owner of the existing database",
      "336331031": '"read_only" or "read_write" required',
      "336331033": "Just data ignore all constraints etc.",
      "336331034": "Restoring data only ignoring foreign key, unique, not null & other constraints",
      "336397205": "ODS versions before ODS@1 are not supported",
      "336397206": "Table @1 does not exist",
      "336397207": "View @1 does not exist",
      "336397208": "At line @1, column @2",
      "336397209": "At unknown line and column",
      "336397210": "Column @1 cannot be repeated in @2 statement",
      "336397211": "Too many values ( more than @1) in member list to match against",
      "336397212": "Array and BLOB data types not allowed in computed field",
      "336397213": "Implicit domain name @1 not allowed in user created domain",
      "336397214": "Scalar operator used on field @1 which is not an array",
      "336397215": "Cannot sort on more than 255 items",
      "336397216": "Cannot group on more than 255 items",
      "336397217": "Cannot include the same field (@1.@2) twice in the ORDER BY clause with conflicting sorting options",
      "336397218": "Column list from derived table @1 has more columns than the number of items in its SELECT statement",
      "336397219": "Column list from derived table @1 has less columns than the number of items in its SELECT statement",
      "336397220": "No column name specified for column number @1 in derived table @2",
      "336397221": "Column @1 was specified multiple times for derived table @2",
      "336397222": "Internal dsql error: alias type expected by pass1_expand_select_node",
      "336397223": "Internal dsql error: alias type expected by pass1_field",
      "336397224": "Internal dsql error: column position out of range in pass1_union_auto_cast",
      "336397225": "Recursive CTE member (@1) can refer itself only in FROM clause",
      "336397226": "CTE '@1' has cyclic dependencies",
      "336397227": "Recursive member of CTE can't be member of an outer join",
      "336397228": "Recursive member of CTE can't reference itself more than once",
      "336397229": "Recursive CTE (@1) must be an UNION",
      "336397230": "CTE '@1' defined non-recursive member after recursive",
      "336397231": "Recursive member of CTE '@1' has @2 clause",
      "336397232": "Recursive members of CTE (@1) must be linked with another members via UNION ALL",
      "336397233": "Non-recursive member is missing in CTE '@1'",
      "336397234": "WITH clause can't be nested",
      "336397235": "Column @1 appears more than once in USING clause",
      "336397236": "Feature is not supported in dialect @1",
      "336397237": 'CTE "@1" is not used in query',
      "336397238": "column @1 appears more than once in ALTER VIEW",
      "336397239": "@1 is not supported inside IN AUTONOMOUS TRANSACTION block",
      "336397240": "Unknown node type @1 in dsql/GEN_expr",
      "336397241": "Argument for @1 in dialect 1 must be string or numeric",
      "336397242": "Argument for @1 in dialect 3 must be numeric",
      "336397243": "Strings cannot be added to or subtracted from DATE or TIME types",
      "336397244": "Invalid data type for subtraction involving DATE, TIME or TIMESTAMP types",
      "336397245": "Adding two DATE values or two TIME values is not allowed",
      "336397246": "DATE value cannot be subtracted from the provided data type",
      "336397247": "Strings cannot be added or subtracted in dialect 3",
      "336397248": "Invalid data type for addition or subtraction in dialect 3",
      "336397249": "Invalid data type for multiplication in dialect 1",
      "336397250": "Strings cannot be multiplied in dialect 3",
      "336397251": "Invalid data type for multiplication in dialect 3",
      "336397252": "Division in dialect 1 must be between numeric data types",
      "336397253": "Strings cannot be divided in dialect 3",
      "336397254": "Invalid data type for division in dialect 3",
      "336397255": "Strings cannot be negated (applied the minus operator) in dialect 3",
      "336397256": "Invalid data type for negation (minus operator)",
      "336397257": "Cannot have more than 255 items in DISTINCT / UNION DISTINCT list",
      "336397258": "ALTER CHARACTER SET @1 failed",
      "336397259": "COMMENT ON @1 failed",
      "336397260": "CREATE FUNCTION @1 failed",
      "336397261": "ALTER FUNCTION @1 failed",
      "336397262": "CREATE OR ALTER FUNCTION @1 failed",
      "336397263": "DROP FUNCTION @1 failed",
      "336397264": "RECREATE FUNCTION @1 failed",
      "336397265": "CREATE PROCEDURE @1 failed",
      "336397266": "ALTER PROCEDURE @1 failed",
      "336397267": "CREATE OR ALTER PROCEDURE @1 failed",
      "336397268": "DROP PROCEDURE @1 failed",
      "336397269": "RECREATE PROCEDURE @1 failed",
      "336397270": "CREATE TRIGGER @1 failed",
      "336397271": "ALTER TRIGGER @1 failed",
      "336397272": "CREATE OR ALTER TRIGGER @1 failed",
      "336397273": "DROP TRIGGER @1 failed",
      "336397274": "RECREATE TRIGGER @1 failed",
      "336397275": "CREATE COLLATION @1 failed",
      "336397276": "DROP COLLATION @1 failed",
      "336397277": "CREATE DOMAIN @1 failed",
      "336397278": "ALTER DOMAIN @1 failed",
      "336397279": "DROP DOMAIN @1 failed",
      "336397280": "CREATE EXCEPTION @1 failed",
      "336397281": "ALTER EXCEPTION @1 failed",
      "336397282": "CREATE OR ALTER EXCEPTION @1 failed",
      "336397283": "RECREATE EXCEPTION @1 failed",
      "336397284": "DROP EXCEPTION @1 failed",
      "336397285": "CREATE SEQUENCE @1 failed",
      "336397286": "CREATE TABLE @1 failed",
      "336397287": "ALTER TABLE @1 failed",
      "336397288": "DROP TABLE @1 failed",
      "336397289": "RECREATE TABLE @1 failed",
      "336397290": "CREATE PACKAGE @1 failed",
      "336397291": "ALTER PACKAGE @1 failed",
      "336397292": "CREATE OR ALTER PACKAGE @1 failed",
      "336397293": "DROP PACKAGE @1 failed",
      "336397294": "RECREATE PACKAGE @1 failed",
      "336397295": "CREATE PACKAGE BODY @1 failed",
      "336397296": "DROP PACKAGE BODY @1 failed",
      "336397297": "RECREATE PACKAGE BODY @1 failed",
      "336397298": "CREATE VIEW @1 failed",
      "336397299": "ALTER VIEW @1 failed",
      "336397300": "CREATE OR ALTER VIEW @1 failed",
      "336397301": "RECREATE VIEW @1 failed",
      "336397302": "DROP VIEW @1 failed",
      "336397303": "DROP SEQUENCE @1 failed",
      "336397304": "RECREATE SEQUENCE @1 failed",
      "336397305": "DROP INDEX @1 failed",
      "336397306": "DROP FILTER @1 failed",
      "336397307": "DROP SHADOW @1 failed",
      "336397308": "DROP ROLE @1 failed",
      "336397309": "DROP USER @1 failed",
      "336397310": "CREATE ROLE @1 failed",
      "336397311": "ALTER ROLE @1 failed",
      "336397312": "ALTER INDEX @1 failed",
      "336397313": "ALTER DATABASE failed",
      "336397314": "CREATE SHADOW @1 failed",
      "336397315": "DECLARE FILTER @1 failed",
      "336397316": "CREATE INDEX @1 failed",
      "336397317": "CREATE USER @1 failed",
      "336397318": "ALTER USER @1 failed",
      "336397319": "GRANT failed",
      "336397320": "REVOKE failed",
      "336397321": "Recursive member of CTE cannot use aggregate or window function",
      "336397322": "@2 MAPPING @1 failed",
      "336397323": "ALTER SEQUENCE @1 failed",
      "336397324": "CREATE GENERATOR @1 failed",
      "336397325": "SET GENERATOR @1 failed",
      "336397326": "WITH LOCK can be used only with a single physical table",
      "336397327": "FIRST/SKIP cannot be used with OFFSET/FETCH or ROWS",
      "336397328": "WITH LOCK cannot be used with aggregates",
      "336397329": "WITH LOCK cannot be used with @1",
      "336397330": "Number of arguments (@1) exceeds the maximum (@2) number of EXCEPTION USING arguments",
      "336397331": "String literal with @1 bytes exceeds the maximum length of @2 bytes",
      "336397332": "String literal with @1 characters exceeds the maximum length of @2 characters for the @3 character set",
      "336397333": "Too many BEGIN\u2026\u200BEND nesting. Maximum level is @1",
      "336397334": "RECREATE USER @1 failed",
      "336723983": "Unable to open database",
      "336723984": "Error in switch specifications",
      "336723985": "No operation specified",
      "336723986": "No user name specified",
      "336723987": "Add record error",
      "336723988": "Modify record error",
      "336723989": "Find / modify record error",
      "336723990": "Record not found for user: @1",
      "336723991": "Delete record error",
      "336723992": "Find / delete record error",
      "336723996": "Find / display record error",
      "336723997": "Invalid parameter, no switch defined",
      "336723998": "Operation already specified",
      "336723999": "Password already specified",
      "336724000": "Uid already specified",
      "336724001": "Gid already specified",
      "336724002": "Project already specified",
      "336724003": "Organization already specified",
      "336724004": "First name already specified",
      "336724005": "Middle name already specified",
      "336724006": "Last name already specified",
      "336724008": "Invalid switch specified",
      "336724009": "Ambiguous switch specified",
      "336724010": "No operation specified for parameters",
      "336724011": "No parameters allowed for this operation",
      "336724012": "Incompatible switches specified",
      "336724044": "Invalid user name (maximum 31 bytes allowed)",
      "336724045": "Warning - maximum 8 significant bytes of password used",
      "336724046": "Database already specified",
      "336724047": "Database administrator name already specified",
      "336724048": "Database administrator password already specified",
      "336724049": "SQL role name already specified",
      "336920577": "Found unknown switch",
      "336920578": "Please retry, giving a database name",
      "336920579": "Wrong ODS version, expected @1, encountered @2",
      "336920580": "Unexpected end of database file",
      "336920605": "Can't open database file @1",
      "336920606": "Can't read a database page",
      "336920607": "System memory exhausted",
      "336986113": "Wrong value for access mode",
      "336986114": "Wrong value for write mode",
      "336986115": "Wrong value for reserve space",
      "336986116": "Unknown tag (@1) in info_svr_db_info block after isc_svc_query()",
      "336986117": "Unknown tag (@1) in isc_svc_query() results",
      "336986118": 'Unknown switch "@1"'
    };
  }
});

// ../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/utils.js
var require_utils = __commonJS({
  "../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/utils.js"(exports2, module2) {
    var MessagesError = require_firebird_msg();
    var Const = require_const();
    var parseDate = (str) => {
      const self2 = str.trim();
      const arr = self2.indexOf(" ") === -1 ? self2.split("T") : self2.split(" ");
      let index = arr[0].indexOf(":");
      const length = arr[0].length;
      if (index !== -1) {
        const tmp = arr[1];
        arr[1] = arr[0];
        arr[0] = tmp;
      }
      if (arr[0] === void 0) {
        arr[0] = "";
      }
      const noTime = arr[1] === void 0 || arr[1].length === 0;
      for (let i = 0; i < length; i++) {
        const c = arr[0].charCodeAt(i);
        if (c > 47 && c < 58) {
          continue;
        }
        if (c === 45 || c === 46) {
          continue;
        }
        if (noTime) {
          return new Date(self2);
        }
      }
      if (arr[1] === void 0) {
        arr[1] = "00:00:00";
      }
      const firstDay = arr[0].indexOf("-") === -1;
      const date = (arr[0] || "").split(firstDay ? "." : "-");
      const time = (arr[1] || "").split(":");
      if (date.length < 4 && time.length < 2) {
        return new Date(self2);
      }
      index = (time[2] || "").indexOf(".");
      if (index !== -1) {
        time[3] = time[2].substring(index + 1);
        time[2] = time[2].substring(0, index);
      } else {
        time[3] = "0";
      }
      const parsed = [
        parseInt(date[firstDay ? 2 : 0], 10),
        // year
        parseInt(date[1], 10),
        // month
        parseInt(date[firstDay ? 0 : 2], 10),
        // day
        parseInt(time[0], 10),
        // hours
        parseInt(time[1], 10),
        // minutes
        parseInt(time[2], 10),
        // seconds
        parseInt(time[3], 10)
        // miliseconds
      ];
      const def = /* @__PURE__ */ new Date();
      for (let i = 0; i < parsed.length; i++) {
        if (isNaN(parsed[i])) {
          parsed[i] = 0;
        }
        const value = parsed[i];
        if (value !== 0) {
          continue;
        }
        switch (i) {
          case 0:
            if (value <= 0) {
              parsed[i] = def.getFullYear();
            }
            break;
          case 1:
            if (value <= 0) {
              parsed[i] = def.getMonth() + 1;
            }
            break;
          case 2:
            if (value <= 0) {
              parsed[i] = def.getDate();
            }
            break;
        }
      }
      return new Date(parsed[0], parsed[1] - 1, parsed[2], parsed[3], parsed[4], parsed[5]);
    };
    var lookupMessages = (status) => {
      const messages = status.map((item) => {
        let text = MessagesError[item.gdscode];
        if (text === void 0) {
          return "Unknow error";
        }
        if (item.params !== void 0) {
          item.params.forEach((param, i) => {
            text = text.replace("@" + (i + 1), param);
          });
        }
        return text;
      });
      return messages.join(", ");
    };
    var escape = function(value, protocolVersion) {
      if (value === null || value === void 0)
        return "NULL";
      switch (typeof value) {
        case "boolean":
          if ((protocolVersion || Const.PROTOCOL_VERSION13) >= Const.PROTOCOL_VERSION13)
            return value ? "true" : "false";
          else
            return value ? "1" : "0";
        case "number":
          return value.toString();
        case "string":
          return "'" + value.replace(/'/g, "''").replace(/\\/g, "\\\\") + "'";
      }
      if (value instanceof Date)
        return "'" + value.getFullYear() + "-" + (value.getMonth() + 1).toString().padLeft(2, "0") + "-" + value.getDate().toString().padLeft(2, "0") + " " + value.getHours().toString().padLeft(2, "0") + ":" + value.getMinutes().toString().padLeft(2, "0") + ":" + value.getSeconds().toString().padLeft(2, "0") + "." + value.getMilliseconds().toString().padLeft(3, "0") + "'";
      throw new Error("Escape supports only primitive values.");
    };
    function noop2() {
    }
    module2.exports = {
      escape,
      lookupMessages,
      noop: noop2,
      parseDate
    };
  }
});

// ../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/eventConnection.js
var require_eventConnection = __commonJS({
  "../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/eventConnection.js"(exports2, module2) {
    var net = require("net");
    var { XdrReader } = require_serialize();
    var DEFAULT_ENCODING = "utf8";
    var Const = require_const();
    var EventConnection = class {
      constructor(host, port, callback, db) {
        var self2 = this;
        this.db = db;
        this.emgr = null;
        this._isClosed = false;
        this._isOpened = false;
        this._socket = net.createConnection(port, host);
        this._bind_events(host, port, callback);
        this.error;
        this.eventcallback;
      }
      _bind_events(host, port, callback) {
        var self2 = this;
        self2._socket.on("close", function() {
          self2._isClosed = true;
        });
        self2._socket.on("error", function(e) {
          self2.error = e;
        });
        self2._socket.on("connect", function() {
          self2._isClosed = false;
          self2._isOpened = true;
          if (callback)
            callback();
        });
        self2._socket.on("data", function(data) {
          var xdr, buf;
          if (!self2._xdr) {
            xdr = new XdrReader(data);
          } else {
            xdr = self2._xdr;
            delete self2._xdr;
            buf = Buffer.from(data.length + xdr.buffer.length);
            xdr.buffer.copy(buf);
            data.copy(buf, xdr.buffer.length);
            xdr.buffer = buf;
          }
          try {
            var item, op;
            var op_pos = xdr.pos;
            var tmp_event;
            while (xdr.pos < xdr.buffer.length) {
              do {
                var r = xdr.readInt();
              } while (r === Const.op_dummy);
              switch (r) {
                case Const.op_event:
                  xdr.readInt();
                  var buf = xdr.readArray();
                  tmp_event = {};
                  var lst_event = [];
                  var eventname = "";
                  var eventcount = 0;
                  var pos = 1;
                  while (pos < buf.length) {
                    var len = buf.readInt8(pos++);
                    eventname = buf.toString(DEFAULT_ENCODING, pos, pos + len);
                    var prevcount = self2.emgr.events[eventname] || 0;
                    pos += len;
                    eventcount = buf.readInt32LE(pos);
                    tmp_event[eventname] = eventcount;
                    pos += 4;
                    if (prevcount !== eventcount)
                      lst_event.push({ name: eventname, count: eventcount });
                  }
                  xdr.readInt64();
                  var event_id = xdr.readInt();
                  for (var evt in tmp_event) {
                    self2.emgr.events[evt] = tmp_event[evt];
                  }
                  if (self2.eventcallback)
                    return self2.eventcallback(null, { eventid: event_id, events: lst_event });
                default:
                  return cb(new Error("Unexpected:" + r));
              }
            }
          } catch (err) {
            if (err instanceof RangeError) {
              xdr.buffer = xdr.buffer = xdr.buffer.slice(op_pos);
              xdr.pos = 0;
              self2._xdr = xdr;
            }
          }
        });
      }
      throwClosed(callback) {
        var err = new Error("Event Connection is closed.");
        this.db.emit("error", err);
        if (callback)
          callback(err);
        return this;
      }
    };
    module2.exports = EventConnection;
  }
});

// ../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/fbEventManager.js
var require_fbEventManager = __commonJS({
  "../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/fbEventManager.js"(exports2, module2) {
    var Events = require("events");
    var { doError } = require_callback();
    var FbEventManager = class extends Events.EventEmitter {
      constructor(db, eventconnection, eventid, callback) {
        super();
        this.db = db;
        this.eventconnection = eventconnection;
        this.events = {};
        this.eventid = eventid;
        this._createEventLoop(callback);
      }
      _createEventLoop(callback) {
        var self2 = this;
        var cnx = this.db.connection;
        this.eventconnection.emgr = this;
        console.log("[EventManager] Creating event loop, eventid:", this.eventid);
        function loop(first) {
          console.log("[EventManager] Calling queEvents, first:", first, "events:", Object.keys(self2.events));
          cnx.queEvents(self2.events, self2.eventid, function(err, ret) {
            console.log("[EventManager] queEvents callback, err:", err, "ret:", ret, "first:", first);
            if (err) {
              console.log("[EventManager] queEvents error:", err);
              doError(err, callback);
              return;
            }
            if (first) {
              console.log("[EventManager] First loop complete, calling callback");
              callback(null);
            }
          });
        }
        this.eventconnection.eventcallback = function(err, ret) {
          console.log("[EventManager] eventcallback invoked, err:", err, "eventid match:", self2.eventid === ret?.eventid);
          if (err || self2.eventid !== ret.eventid) {
            doError(err || new Error("Bad eventid"), callback);
            return;
          }
          ret.events.forEach(function(event) {
            self2.emit("post_event", event.name, event.count);
          });
          loop(false);
        };
        loop(true);
      }
      _changeEvent(callback) {
        var self2 = this;
        console.log("[EventManager] _changeEvent called, eventid:", this.eventid, "events:", Object.keys(self2.events));
        var savedCallback = self2.eventconnection.eventcallback;
        self2.eventconnection.eventcallback = null;
        console.log("[EventManager] Suppressed event callback, calling closeEvents");
        self2.db.connection.closeEvents(this.eventid, function(err) {
          console.log("[EventManager] closeEvents callback, err:", err);
          if (err) {
            self2.eventconnection.eventcallback = savedCallback;
            doError(err, callback);
            return;
          }
          console.log("[EventManager] closeEvents success, calling queEvents");
          self2.db.connection.queEvents(self2.events, self2.eventid, function(err2, ret) {
            console.log("[EventManager] queEvents callback in _changeEvent, err:", err2, "ret:", ret);
            self2.eventconnection.eventcallback = savedCallback;
            console.log("[EventManager] Restored event callback");
            if (err2) {
              console.log("[EventManager] queEvents error in _changeEvent:", err2);
              doError(err2, callback);
              return;
            }
            console.log("[EventManager] _changeEvent complete, calling final callback");
            callback(null, ret);
          });
        });
      }
      registerEvent(events, callback) {
        var self2 = this;
        console.log("[EventManager] registerEvent called with events:", events);
        console.log("[EventManager] Connection closed?", self2.db.connection._isClosed, "Event connection closed?", self2.eventconnection._isClosed);
        if (self2.db.connection._isClosed || self2.eventconnection._isClosed)
          return self2.eventconnection.throwClosed(callback);
        events.forEach((event) => self2.events[event] = self2.events[event] || 0);
        console.log("[EventManager] Events registered, current events:", Object.keys(self2.events));
        self2._changeEvent(callback);
      }
      unregisterEvent(events, callback) {
        var self2 = this;
        if (self2.db.connection._isClosed || self2.eventconnection._isClosed)
          return self2.eventconnection.throwClosed(callback);
        events.forEach(function(event) {
          delete self2.events[event];
        });
        self2._changeEvent(callback);
      }
      close(callback) {
        var self2 = this;
        self2.eventconnection.eventcallback = null;
        self2.db.connection.closeEvents(this.eventid, function(err) {
          if (err) {
            doError(err, callback);
            return;
          }
          self2.eventconnection._socket.end();
          if (callback)
            callback();
        });
      }
    };
    module2.exports = FbEventManager;
  }
});

// ../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/database.js
var require_database = __commonJS({
  "../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/database.js"(exports2, module2) {
    var Events = require("events");
    var { doError } = require_callback();
    var { escape } = require_utils();
    var Const = require_const();
    var EventConnection = require_eventConnection();
    var FbEventManager = require_fbEventManager();
    function readblob(blob, callback) {
      if (blob === void 0 || blob === null) {
        callback(null, blob);
        return;
      }
      if (typeof blob !== "function") {
        callback(null, blob);
        return;
      }
      blob(function(err, name, e) {
        if (err) {
          callback(err);
          return;
        }
        if (!e) {
          callback(null, null);
          return;
        }
        const chunks = [];
        let chunksLength = 0;
        e.on("data", function(chunk) {
          chunksLength += chunk.length;
          chunks.push(chunk);
        });
        e.on("end", function() {
          callback(null, Buffer.concat(chunks, chunksLength));
        });
        e.on("error", function(streamErr) {
          callback(streamErr);
        });
      });
    }
    function fetchBlobSyncRow(row, meta, callback) {
      if (!row || !meta || !meta.length) {
        callback(null, row);
        return;
      }
      const rowKeys = Object.keys(row);
      const blobColumns = [];
      for (let i = 0; i < meta.length; i++) {
        if (meta[i] && meta[i].type === Const.SQL_BLOB && rowKeys[i] !== void 0) {
          blobColumns.push(rowKeys[i]);
        }
      }
      if (!blobColumns.length) {
        callback(null, row);
        return;
      }
      let pending = blobColumns.length;
      let blobErr;
      blobColumns.forEach(function(columnName) {
        readblob(row[columnName], function(err, data) {
          if (err && !blobErr) {
            blobErr = err;
          }
          row[columnName] = data;
          pending--;
          if (pending === 0) {
            callback(blobErr, row);
          }
        });
      });
    }
    var Database = class extends Events.EventEmitter {
      constructor(connection) {
        super();
        this.connection = connection;
        connection.db = this;
        this.eventid = 1;
      }
      escape(value) {
        return escape(value, this.connection.accept.protocolVersion);
      }
      detach(callback, force) {
        var self2 = this;
        if (!force && self2.connection._pending.length > 0) {
          self2.connection._detachAuto = true;
          self2.connection._detachCallback = callback;
          return self2;
        }
        if (self2.connection._pooled === false) {
          self2.connection.detach(function(err, obj) {
            self2.connection.disconnect();
            self2.emit("detach", false);
            if (callback)
              callback(err, obj);
          }, force);
        } else {
          self2.emit("detach", false);
          if (callback)
            callback();
        }
        return self2;
      }
      transaction(options, callback) {
        return this.startTransaction(options, callback);
      }
      startTransaction(options, callback) {
        this.connection.startTransaction(options, callback);
        return this;
      }
      newStatement(query, callback) {
        this.startTransaction(function(err, transaction) {
          if (err) {
            callback(err);
            return;
          }
          transaction.newStatement(query, function(err2, statement) {
            if (err2) {
              callback(err2);
              return;
            }
            transaction.commit(function(err3) {
              callback(err3, statement);
            });
          });
        });
        return this;
      }
      execute(query, params, callback, custom2) {
        if (params instanceof Function) {
          custom2 = callback;
          callback = params;
          params = void 0;
        }
        var self2 = this;
        self2.connection.startTransaction(function(err, transaction) {
          if (err) {
            doError(err, callback);
            return;
          }
          transaction.execute(query, params, function(err2, result, meta, isSelect) {
            if (err2) {
              transaction.rollback(function() {
                doError(err2, callback);
              });
              return;
            }
            transaction.commit(function(err3) {
              if (callback)
                callback(err3, result, meta, isSelect);
            });
          }, custom2);
        });
        return self2;
      }
      sequentially(query, params, on, callback, asArray) {
        if (params instanceof Function) {
          asArray = callback;
          callback = on;
          on = params;
          params = void 0;
        }
        if (on === void 0) {
          throw new Error('Expected "on" delegate.');
        }
        if (callback instanceof Boolean) {
          asArray = callback;
          callback = void 0;
        }
        var self2 = this;
        var _on = function(row, i, meta, next) {
          var done = false;
          var finish = function(err) {
            if (done) {
              return;
            }
            done = true;
            next(err);
          };
          fetchBlobSyncRow(row, meta, function(blobErr) {
            if (blobErr) {
              finish(blobErr);
              return;
            }
            try {
              var ret;
              if (on.length >= 3) {
                ret = on(row, i, finish);
              } else {
                ret = on(row, i);
              }
              if (ret && typeof ret.then === "function") {
                ret.then(function() {
                  finish();
                }).catch(finish);
              } else if (on.length < 3) {
                finish();
              }
            } catch (err) {
              finish(err);
            }
          });
        };
        self2.execute(query, params, callback, { asObject: !asArray, asStream: true, on: _on });
        return self2;
      }
      query(query, params, callback) {
        if (params instanceof Function) {
          callback = params;
          params = void 0;
        }
        var self2 = this;
        self2.execute(query, params, callback, { asObject: true, asStream: callback === void 0 || callback === null });
        return self2;
      }
      drop(callback) {
        return this.connection.dropDatabase(callback);
      }
      attachEvent(callback) {
        var self2 = this;
        this.connection.auxConnection(function(err, socket_info) {
          if (err) {
            doError(err, callback);
            return;
          }
          const host = socket_info.host === "0.0.0.0" || socket_info.host === "::" ? self2.connection.options.host : socket_info.host;
          const eventConnection = new EventConnection(
            host,
            socket_info.port,
            function(err2) {
              if (err2) {
                doError(err2, callback);
                return;
              }
              const evt = new FbEventManager(self2, eventConnection, self2.eventid++, function(err3) {
                if (err3) {
                  doError(err3, callback);
                  return;
                }
                callback(err3, evt);
              });
            },
            self2
          );
        });
        return this;
      }
    };
    module2.exports = Database;
  }
});

// ../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/statement.js
var require_statement = __commonJS({
  "../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/statement.js"(exports2, module2) {
    var Statement = class {
      constructor(connection) {
        this.connection = connection;
      }
      close(callback) {
        this.connection.closeStatement(this, callback);
      }
      drop(callback) {
        this.connection.dropStatement(this, callback);
      }
      release(callback) {
        var cache_query = this.connection.getCachedQuery(this.query);
        if (cache_query)
          this.connection.closeStatement(this, callback);
        else
          this.connection.dropStatement(this, callback);
      }
      execute(transaction, params, callback, custom2) {
        if (params instanceof Function) {
          custom2 = callback;
          callback = params;
          params = void 0;
        }
        this.custom = custom2;
        this.connection.executeStatement(transaction, this, params, callback, custom2);
      }
      fetch(transaction, count, callback) {
        this.connection.fetch(this, transaction, count, callback);
      }
      fetchAll(transaction, callback) {
        this.connection.fetchAll(this, transaction, callback);
      }
    };
    module2.exports = Statement;
  }
});

// ../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/transaction.js
var require_transaction = __commonJS({
  "../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/transaction.js"(exports2, module2) {
    var { doCallback, doError } = require_callback();
    var Const = require_const();
    var Transaction = class {
      constructor(connection) {
        this.connection = connection;
        this.db = connection.db;
      }
      newStatement(query, callback) {
        var cnx = this.connection;
        var self2 = this;
        var query_cache = cnx.getCachedQuery(query);
        if (query_cache) {
          callback(null, query_cache);
        } else {
          cnx.prepare(self2, query, false, callback);
        }
      }
      execute(query, params, callback, custom2) {
        if (params instanceof Function) {
          custom2 = callback;
          callback = params;
          params = void 0;
        }
        var self2 = this;
        this.newStatement(query, function(err, statement) {
          if (err) {
            doError(err, callback);
            return;
          }
          function dropError(err2) {
            statement.release();
            doCallback(err2, callback);
          }
          statement.execute(self2, params, function(err2, ret) {
            if (err2) {
              dropError(err2);
              return;
            }
            switch (statement.type) {
              case Const.isc_info_sql_stmt_select:
                statement.fetchAll(self2, function(err3, r) {
                  if (err3) {
                    dropError(err3);
                    return;
                  }
                  statement.release();
                  if (callback)
                    callback(void 0, r, statement.output, true);
                });
                break;
              case Const.isc_info_sql_stmt_exec_procedure:
                if (ret && ret.data && ret.data.length > 0) {
                  statement.release();
                  if (callback)
                    callback(void 0, ret.data[0], statement.output, true);
                  break;
                } else if (statement.output.length) {
                  statement.fetch(self2, 1, function(err3, ret2) {
                    if (err3) {
                      dropError(err3);
                      return;
                    }
                    statement.release();
                    if (callback)
                      callback(void 0, ret2.data[0], statement.output, false);
                  });
                  break;
                }
              // Fall through is normal
              default:
                statement.release();
                if (callback)
                  callback();
                break;
            }
          }, custom2);
        });
      }
      sequentially(query, params, on, callback, asArray) {
        if (params instanceof Function) {
          asArray = callback;
          callback = on;
          on = params;
          params = void 0;
        }
        if (on === void 0) {
          throw new Error('Expected "on" delegate.');
        }
        if (callback instanceof Boolean) {
          asArray = callback;
          callback = void 0;
        }
        var self2 = this;
        var _on = function(row, i, meta, next) {
          var done = false;
          var finish = function(err) {
            if (done) {
              return;
            }
            done = true;
            next(err);
          };
          try {
            var ret;
            if (on.length >= 3) {
              ret = on(row, i, finish);
            } else {
              ret = on(row, i);
            }
            if (ret && typeof ret.then === "function") {
              ret.then(function() {
                finish();
              }).catch(finish);
            } else if (on.length < 3) {
              finish();
            }
          } catch (err) {
            finish(err);
          }
        };
        self2.execute(query, params, callback, { asObject: !asArray, asStream: true, on: _on });
        return self2;
      }
      query(query, params, callback) {
        if (params instanceof Function) {
          callback = params;
          params = void 0;
        }
        if (callback === void 0)
          callback = noop;
        this.execute(query, params, callback, { asObject: true, asStream: callback === void 0 || callback === null });
      }
      commit(callback) {
        this.connection.commit(this, callback);
      }
      rollback(callback) {
        this.connection.rollback(this, callback);
      }
      commitRetaining(callback) {
        this.connection.commitRetaining(this, callback);
      }
      rollbackRetaining(callback) {
        this.connection.rollbackRetaining(this, callback);
      }
    };
    module2.exports = Transaction;
  }
});

// ../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/socket.js
var require_socket = __commonJS({
  "../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/socket.js"(exports2, module2) {
    var net = require("net");
    var zlib = require("zlib");
    var Arc4 = class {
      constructor(key) {
        this._s = new Uint8Array(256);
        this._i = 0;
        this._j = 0;
        for (var i = 0; i < 256; i++) {
          this._s[i] = i;
        }
        var j = 0;
        for (var i = 0; i < 256; i++) {
          j = j + this._s[i] + key[i % key.length] & 255;
          var tmp = this._s[i];
          this._s[i] = this._s[j];
          this._s[j] = tmp;
        }
      }
      /**
       * Transform (encrypt/decrypt) data in place.
       * RC4 is symmetric - encrypt and decrypt are the same operation.
       */
      transform(data) {
        var out = Buffer.alloc(data.length);
        for (var n = 0; n < data.length; n++) {
          this._i = this._i + 1 & 255;
          this._j = this._j + this._s[this._i] & 255;
          var tmp = this._s[this._i];
          this._s[this._i] = this._s[this._j];
          this._s[this._j] = tmp;
          var k = this._s[this._s[this._i] + this._s[this._j] & 255];
          out[n] = data[n] ^ k;
        }
        return out;
      }
    };
    var Socket = class {
      constructor(port, host) {
        this._socket = net.createConnection(port, host);
        this._socket.setNoDelay(true);
        this.compressor = null;
        this.compressorBuffer = [];
        this.decompressor = null;
        this.decompressorBuffer = [];
        this.buffer = null;
        this.encrypt = false;
        this.encryptCipher = null;
        this.decryptCipher = null;
        return new Proxy(this._socket, this);
      }
      /**
       * Decompress and/or decrypt data when received.
       * Override on data event.
       */
      on(event, cb2) {
        if (event === "data") {
          const mainCb = cb2;
          cb2 = (data) => {
            if (this.encrypt) {
              data = this.decryptCipher.transform(data);
            }
            if (this.compress) {
              this.decompressor.write(data, () => {
                mainCb(Buffer.concat(this.decompressorBuffer));
                this.decompressorBuffer = [];
              });
            } else {
              mainCb(data);
            }
          };
        }
        this._socket.on(event, cb2);
      }
      /**
       * Compress and/or encrypt data before sending to socket.
       */
      write(data, defer = false) {
        if (defer) {
          this.buffer = Buffer.from(data);
          return;
        }
        if (!defer && this.buffer) {
          data = Buffer.concat([this.buffer, data]);
          this.buffer = null;
        }
        if (this.compress) {
          this.compressor.write(data, () => {
            var compressedData = Buffer.concat(this.compressorBuffer);
            this.compressorBuffer = [];
            if (this.encrypt) {
              compressedData = this.encryptCipher.transform(compressedData);
            }
            this._socket.write(compressedData);
          });
        } else if (this.encrypt) {
          this._socket.write(this.encryptCipher.transform(data));
        } else {
          this._socket.write(data);
        }
      }
      /**
       * Enable compression/decompression on the fly.
       */
      enableCompression() {
        this.compress = true;
        this.decompressor = zlib.createInflate();
        this.decompressor.on("data", (inflate) => {
          this.decompressorBuffer.push(inflate);
        });
        this.compressor = zlib.createDeflate({
          flush: zlib.constants.Z_FULL_FLUSH,
          finishFlush: zlib.constants.Z_SYNC_FLUSH
        });
        this.compressor.on("data", (deflate) => {
          this.compressorBuffer.push(deflate);
        });
      }
      /**
       * Enable encryption/decryption using Arc4 cipher.
       * @param {Buffer} sessionKey - The session key from SRP authentication.
       */
      enableEncryption(sessionKey) {
        this.encrypt = true;
        this.encryptCipher = new Arc4(sessionKey);
        this.decryptCipher = new Arc4(sessionKey);
      }
      /**
       * Proxy trap.
       */
      get(target, field) {
        if (field in this) {
          return this[field].bind(this);
        }
        return target[field];
      }
    };
    module2.exports = Socket;
    module2.exports.Arc4 = Arc4;
  }
});

// ../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/connection.js
var require_connection = __commonJS({
  "../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/wire/connection.js"(exports2, module2) {
    var Events = require("events");
    var os = require("os");
    var path = require("path");
    var BigInt2 = require_BigInteger();
    var { XdrWriter, BlrWriter, XdrReader, BitSet, BlrReader } = require_serialize();
    var { doCallback, doError } = require_callback();
    var srp = require_srp();
    var crypt = require_unix_crypt();
    var Const = require_const();
    var Xsql = require_xsqlvar();
    var ServiceManager = require_service();
    var Database = require_database();
    var Statement = require_statement();
    var Transaction = require_transaction();
    var { lookupMessages, noop: noop2, parseDate } = require_utils();
    var Socket = require_socket();
    var Connection = class _Connection {
      constructor(host, port, callback, options, db, svc) {
        var self2 = this;
        this.db = db;
        this.svc = svc;
        this._msg = new XdrWriter(32);
        this._blr = new BlrWriter(32);
        this._queue = [];
        this._detachTimeout;
        this._detachCallback;
        this._detachAuto;
        this._socket = new Socket(port, host);
        this._pending = [];
        this._isOpened = false;
        this._isClosed = false;
        this._isDetach = false;
        this._isUsed = false;
        this._pooled = options.isPool || false;
        if (options && options.blobChunkSize > 65535) options.blobChunkSize = 65535;
        this.options = options;
        this._bind_events(host, port, callback);
        this.error;
        this._retry_connection_id;
        this._retry_connection_interval = options.retryConnectionInterval || 1e3;
        this._max_cached_query = options.maxCachedQuery || -1;
        this._cache_query = options.cacheQuery ? {} : null;
        this._messageFile = options.messageFile || path.join(__dirname, "firebird.msg");
      }
      _setcachedquery(query, statement) {
        if (this._cache_query) {
          if (this._max_cached_query === -1 || this._max_cached_query > Object.keys(this._cache_query).length) {
            this._cache_query[query] = statement;
          }
        }
      }
      getCachedQuery(query) {
        return this._cache_query ? this._cache_query[query] : null;
      }
      _bind_events(host, port, callback) {
        var self2 = this;
        self2._socket.on("close", function() {
          if (!self2._isOpened || self2._isDetach) {
            return;
          }
          self2._isOpened = false;
          if (!self2.db) {
            if (callback)
              callback(self2.error);
            return;
          }
          self2._retry_connection_id = setTimeout(function() {
            self2._socket.removeAllListeners();
            self2._socket = null;
            var ctx = new _Connection(host, port, function(err) {
              ctx.connect(self2.options, function(err2) {
                if (err2) {
                  self2.db.emit("error", err2);
                  return;
                }
                ctx.attach(self2.options, function(err3) {
                  if (err3) {
                    self2.db.emit("error", err3);
                    return;
                  }
                  ctx._queue = ctx._queue.concat(self2._queue);
                  ctx._pending = ctx._pending.concat(self2._pending);
                  self2.db.emit("reconnect");
                }, self2.db);
              });
              Object.assign(self2, ctx);
            }, self2.options, self2.db);
          }, self2._retry_connection_interval);
        });
        self2._socket.on("error", function(e) {
          self2.error = e;
          if (self2.db)
            self2.db.emit("error", e);
          if (callback)
            callback(e);
        });
        self2._socket.on("connect", function() {
          self2._isClosed = false;
          self2._isOpened = true;
          if (callback)
            callback();
        });
        self2._socket.on("data", function(data) {
          var xdr;
          if (!self2._xdr) {
            xdr = new XdrReader(data);
          } else {
            xdr = new XdrReader(Buffer.concat([self2._xdr.buffer, data], self2._xdr.buffer.length + data.length));
            delete self2._xdr;
          }
          while (xdr.pos < xdr.buffer.length) {
            var cb2 = self2._queue[0], pos = xdr.pos;
            decodeResponse(xdr, cb2, self2, self2._lowercase_keys, function(err, obj) {
              if (err) {
                xdr.buffer = xdr.buffer.slice(pos);
                xdr.pos = 0;
                self2._xdr = xdr;
                if (self2.accept.protocolMinimumType === Const.ptype_lazy_send && self2._queue.length > 0) {
                  self2._queue[0].lazy_count = 2;
                }
                return;
              }
              if (xdr.r) {
                delete xdr.r;
              }
              self2._queue.shift();
              self2._pending.shift();
              if (obj && obj.status) {
                obj.message = lookupMessages(obj.status);
                doCallback(obj, cb2);
              } else {
                doCallback(obj, cb2);
              }
            });
            if (xdr.pos === 0) {
              break;
            }
          }
          if (!self2._detachAuto || self2._pending.length !== 0) {
            return;
          }
          clearTimeout(self2._detachTimeout);
          self2._detachTimeout = setTimeout(function() {
            self2.db.detach(self2._detachCallback);
            self2._detachAuto = false;
          }, 100);
        });
      }
      disconnect() {
        this._socket.end();
      }
      sendOpContAuth(authData, authDataEnc, pluginName) {
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_cont_auth);
        msg.addString(authData, authDataEnc);
        msg.addString(pluginName, Const.DEFAULT_ENCODING);
        msg.addString(Const.AUTH_PLUGIN_LIST.join(","), Const.DEFAULT_ENCODING);
        msg.addInt(0);
        this._socket.write(msg.getData());
      }
      sendOpCrypt(encryptPlugin) {
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_crypt);
        msg.addString(encryptPlugin || "Arc4", Const.DEFAULT_ENCODING);
        msg.addString("Symmetric", Const.DEFAULT_ENCODING);
        this._socket.write(msg.getData());
      }
      sendOpCryptKeyCallback(pluginData) {
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_crypt_key_callback);
        msg.addBlr(pluginData);
        this._socket.write(msg.getData());
      }
      _queueEvent(callback, defer = false) {
        var self2 = this;
        if (self2._isClosed) {
          if (callback)
            callback(new Error("Connection is closed."));
          return;
        }
        const canDefer = defer && this.accept.protocolVersion >= Const.PROTOCOL_VERSION11;
        self2._socket.write(self2._msg.getData(), canDefer);
        if (canDefer && callback) {
          callback();
        } else {
          self2._queue.push(callback);
        }
      }
      connect(options, callback) {
        var pluginName = options.manager ? Const.AUTH_PLUGIN_LEGACY : options.pluginName || Const.AUTH_PLUGIN_LIST[0];
        var msg = this._msg;
        var blr = this._blr;
        this._pending.push("connect");
        msg.pos = 0;
        blr.pos = 0;
        blr.addString(Const.CNCT_login, options.user, Const.DEFAULT_ENCODING);
        blr.addString(Const.CNCT_plugin_name, pluginName, Const.DEFAULT_ENCODING);
        blr.addString(Const.CNCT_plugin_list, Const.AUTH_PLUGIN_LIST.join(","), Const.DEFAULT_ENCODING);
        var specificData = "";
        if (Const.AUTH_PLUGIN_SRP_LIST.indexOf(pluginName) > -1) {
          this.clientKeys = srp.clientSeed();
          specificData = this.clientKeys.public.toString(16);
          blr.addMultiblockPart(Const.CNCT_specific_data, specificData, Const.DEFAULT_ENCODING);
        } else if (pluginName === Const.AUTH_PLUGIN_LEGACY) {
          specificData = crypt.crypt(options.password, Const.LEGACY_AUTH_SALT).substring(2);
          blr.addMultiblockPart(Const.CNCT_specific_data, specificData, Const.DEFAULT_ENCODING);
        } else {
          doError(new Error("Invalide auth plugin '" + pluginName + "'"), callback);
          return;
        }
        blr.addBytes([Const.CNCT_client_crypt, 4, options.wireCrypt !== void 0 ? options.wireCrypt : Const.WIRE_CRYPT_ENABLE, 0, 0, 0]);
        blr.addString(Const.CNCT_user, os.userInfo().username || "Unknown", Const.DEFAULT_ENCODING);
        blr.addString(Const.CNCT_host, os.hostname(), Const.DEFAULT_ENCODING);
        blr.addBytes([Const.CNCT_user_verification, 0]);
        msg.addInt(Const.op_connect);
        msg.addInt(Const.op_attach);
        msg.addInt(Const.CONNECT_VERSION3);
        msg.addInt(Const.ARCHITECTURE_GENERIC);
        msg.addString(options.database || options.filename, Const.DEFAULT_ENCODING);
        msg.addInt(Const.SUPPORTED_PROTOCOL.length);
        msg.addBlr(this._blr);
        for (var protocol of Const.SUPPORTED_PROTOCOL) {
          msg.addInt(protocol[0]);
          msg.addInt(protocol[1]);
          msg.addInt(protocol[2]);
          if (protocol[0] >= Const.PROTOCOL_VERSION13 && options.wireCompression) {
            msg.addInt(protocol[3] | Const.pflag_compress);
          } else {
            msg.addInt(protocol[3]);
          }
          msg.addInt(protocol[4]);
        }
        var self2 = this;
        function cb2(err, ret) {
          if (err) {
            doError(err, callback);
            return;
          }
          if (self2._pendingAccept) {
            ret = self2._pendingAccept;
            delete self2._pendingAccept;
          }
          self2.accept = ret;
          if (ret.sessionKey && ret.protocolVersion >= Const.PROTOCOL_VERSION13 && options.wireCrypt !== Const.WIRE_CRYPT_DISABLE) {
            var keyBuf = Buffer.from(srp.hexPad(ret.sessionKey.toString(16)), "hex");
            self2.sendOpCrypt("Arc4");
            self2._socket.enableEncryption(keyBuf);
            self2._pending.push("crypt");
            self2._queue.push(function(cryptErr) {
              if (cryptErr) {
                doError(cryptErr, callback);
                return;
              }
              if (callback)
                callback(void 0, ret);
            });
            return;
          }
          if (callback)
            callback(void 0, ret);
        }
        this._queueEvent(cb2);
      }
      attach(options, callback, db) {
        this._lowercase_keys = options.lowercase_keys || Const.DEFAULT_LOWERCASE_KEYS;
        var database = options.database || options.filename;
        if (database == null || database.length === 0) {
          doError(new Error("No database specified"), callback);
          return;
        }
        var user = options.user || Const.DEFAULT_USER;
        var password = options.password || Const.DEFAULT_PASSWORD;
        var role = options.role;
        var self2 = this;
        var msg = this._msg;
        var blr = this._blr;
        msg.pos = 0;
        blr.pos = 0;
        blr.addByte(Const.isc_dpb_version1);
        blr.addString(Const.isc_dpb_lc_ctype, options.encoding || "UTF8", Const.DEFAULT_ENCODING);
        if (this.accept.protocolVersion >= Const.PROTOCOL_VERSION13) {
          blr.addByte(Const.isc_dpb_utf8_filename);
          blr.addByte(0);
        }
        blr.addString(Const.isc_dpb_user_name, user, Const.DEFAULT_ENCODING);
        if (options.password && !this.accept.authData) {
          if (this.accept.protocolVersion < Const.PROTOCOL_VERSION13) {
            if (this.accept.protocolVersion === Const.PROTOCOL_VERSION10) {
              blr.addString(Const.isc_dpb_password, password, Const.DEFAULT_ENCODING);
            } else {
              blr.addString(Const.isc_dpb_password_enc, crypt.crypt(password, Const.LEGACY_AUTH_SALT).substring(2), Const.DEFAULT_ENCODING);
            }
          }
        }
        if (role)
          blr.addString(Const.isc_dpb_sql_role_name, role, Const.DEFAULT_ENCODING);
        blr.addBytes([Const.isc_dpb_process_id, 4]);
        blr.addInt32(process.pid);
        let processName = process.title || "";
        blr.addString(Const.isc_dpb_process_name, processName.length > 255 ? processName.substring(processName.length - 255, processName.length) : processName, Const.DEFAULT_ENCODING);
        if (this.accept.authData) {
          blr.addString(Const.isc_dpb_specific_auth_data, this.accept.authData, Const.DEFAULT_ENCODING);
        }
        msg.addInt(Const.op_attach);
        msg.addInt(0);
        msg.addString(database, Const.DEFAULT_ENCODING);
        msg.addBlr(this._blr);
        function cb2(err, ret) {
          if (err) {
            doError(err, callback);
            return;
          }
          self2.dbhandle = ret.handle;
          if (callback)
            callback(void 0, ret);
        }
        if (db) {
          db.connection = this;
          cb2.response = db;
        } else {
          cb2.response = new Database(this);
          cb2.response.removeAllListeners("error");
          cb2.response.on("error", noop2);
        }
        this._queueEvent(cb2);
      }
      detach(callback) {
        var self2 = this;
        if (self2._isClosed)
          return;
        self2._isUsed = false;
        self2._isDetach = true;
        var msg = self2._msg;
        msg.pos = 0;
        msg.addInt(Const.op_detach);
        msg.addInt(0);
        self2._queueEvent(function(err, ret) {
          clearTimeout(self2._retry_connection_id);
          delete self2.dbhandle;
          if (callback)
            callback(err, ret);
        });
      }
      createDatabase(options, callback) {
        var database = options.database || options.filename;
        if (database == null || database.length === 0) {
          doError(new Error("No database specified"), callback);
          return;
        }
        var user = options.user || Const.DEFAULT_USER;
        var password = options.password || Const.DEFAULT_PASSWORD;
        var pageSize = options.pageSize || Const.DEFAULT_PAGE_SIZE;
        var role = options.role;
        var blr = this._blr;
        blr.pos = 0;
        blr.addByte(Const.isc_dpb_version1);
        blr.addString(Const.isc_dpb_set_db_charset, "UTF8", Const.DEFAULT_ENCODING);
        blr.addString(Const.isc_dpb_lc_ctype, "UTF8", Const.DEFAULT_ENCODING);
        if (this.accept.protocolVersion >= Const.PROTOCOL_VERSION13) {
          blr.addByte(Const.isc_dpb_utf8_filename);
          blr.addByte(0);
        }
        blr.addString(Const.isc_dpb_user_name, user, Const.DEFAULT_ENCODING);
        if (this.accept.protocolVersion < Const.PROTOCOL_VERSION13) {
          if (this.accept.protocolVersion === Const.PROTOCOL_VERSION10) {
            blr.addString(Const.isc_dpb_password, password, Const.DEFAULT_ENCODING);
          } else {
            blr.addString(Const.isc_dpb_password_enc, crypt.crypt(password, Const.LEGACY_AUTH_SALT).substring(2), Const.DEFAULT_ENCODING);
          }
        }
        if (role)
          blr.addString(Const.isc_dpb_sql_role_name, role, Const.DEFAULT_ENCODING);
        blr.addBytes([Const.isc_dpb_process_id, 4]);
        blr.addInt32(process.pid);
        let processName = process.title || "";
        blr.addString(Const.isc_dpb_process_name, processName.length > 255 ? processName.substring(processName.length - 255, processName.length) : processName, Const.DEFAULT_ENCODING);
        if (this.accept.authData) {
          blr.addString(Const.isc_dpb_specific_auth_data, this.accept.authData, Const.DEFAULT_ENCODING);
        }
        blr.addNumeric(Const.isc_dpb_sql_dialect, 3);
        blr.addNumeric(Const.isc_dpb_force_write, 1);
        blr.addNumeric(Const.isc_dpb_overwrite, 1);
        blr.addNumeric(Const.isc_dpb_page_size, pageSize);
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_create);
        msg.addInt(0);
        msg.addString(database, Const.DEFAULT_ENCODING);
        msg.addBlr(blr);
        var self2 = this;
        function cb2(err, ret) {
          if (ret)
            self2.dbhandle = ret.handle;
          setImmediate(function() {
            if (self2.db)
              self2.db.emit("attach", ret);
          });
          if (callback)
            callback(err, ret);
        }
        cb2.response = new Database(this);
        this._queueEvent(cb2);
      }
      dropDatabase(callback) {
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_drop_database);
        msg.addInt(this.dbhandle);
        var self2 = this;
        this._queueEvent(function(err) {
          self2.detach(function() {
            self2.disconnect();
            if (callback)
              callback(err);
          });
        });
      }
      throwClosed(callback) {
        var err = new Error("Connection is closed.");
        this.db.emit("error", err);
        if (callback)
          callback(err);
        return this;
      }
      startTransaction(options, callback) {
        if (typeof options === "function") {
          var tmp = options;
          options = callback;
          callback = tmp;
        }
        if (Array.isArray(options)) {
          options = {
            isolation: options,
            readOnly: options === Const.ISOLATION_READ_COMMITTED_READ_ONLY
          };
        }
        options = Object.assign({
          autoCommit: false,
          autoUndo: true,
          isolation: Const.ISOLATION_READ_COMMITTED,
          ignoreLimbo: false,
          //lock: [],
          readOnly: false,
          wait: true,
          waitTimeout: 0
        }, options);
        if (this._isClosed)
          return this.throwClosed(callback);
        this._pending.push("startTransaction");
        var blr = this._blr;
        var msg = this._msg;
        blr.pos = 0;
        msg.pos = 0;
        blr.addByte(Const.isc_tpb_version3);
        blr.addBytes(options.isolation);
        blr.addByte(options.readOnly ? Const.isc_tpb_read : Const.isc_tpb_write);
        if (options.wait) {
          blr.addByte(Const.isc_tpb_wait);
          if (options.waitTimeout) {
            blr.addNumeric(Const.isc_tpb_lock_timeout, options.waitTimeout);
          }
        } else {
          blr.addByte(Const.isc_tpb_nowait);
        }
        if (!options.autoUndo) {
          blr.addByte(Const.isc_tpb_no_auto_undo);
        }
        if (options.autoCommit) {
          blr.addByte(Const.isc_tpb_autocommit);
        }
        if (options.ignoreLimbo) {
          blr.addByte(Const.isc_tpb_ignore_limbo);
        }
        msg.addInt(Const.op_transaction);
        msg.addInt(this.dbhandle);
        msg.addBlr(blr);
        callback.response = new Transaction(this);
        this.db.emit("transaction", options);
        this._queueEvent(callback);
      }
      commit(transaction, callback) {
        if (this._isClosed)
          return this.throwClosed(callback);
        this._pending.push("commit");
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_commit);
        msg.addInt(transaction.handle);
        this.db.emit("commit");
        this._queueEvent(callback);
      }
      rollback(transaction, callback) {
        if (this._isClosed)
          return this.throwClosed(callback);
        this._pending.push("rollback");
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_rollback);
        msg.addInt(transaction.handle);
        this.db.emit("rollback");
        this._queueEvent(callback);
      }
      commitRetaining(transaction, callback) {
        if (this._isClosed)
          throw new Error("Connection is closed.");
        this._pending.push("commitRetaining");
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_commit_retaining);
        msg.addInt(transaction.handle);
        this._queueEvent(callback);
      }
      rollbackRetaining(transaction, callback) {
        if (this._isClosed)
          return this.throwClosed(callback);
        this._pending.push("rollbackRetaining");
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_rollback_retaining);
        msg.addInt(transaction.handle);
        this._queueEvent(callback);
      }
      allocateStatement(callback) {
        if (this._isClosed)
          return this.throwClosed(callback);
        this._pending.push("allocateStatement");
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_allocate_statement);
        msg.addInt(this.dbhandle);
        callback.response = new Statement(this);
        this._queueEvent(callback);
      }
      dropStatement(statement, callback) {
        if (this._isClosed)
          return this.throwClosed(callback);
        this._pending.push("dropStatement");
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_free_statement);
        msg.addInt(statement.handle);
        msg.addInt(Const.DSQL_drop);
        this._queueEvent(callback, true);
      }
      closeStatement(statement, callback) {
        if (this._isClosed)
          return this.throwClosed(callback);
        this._pending.push("closeStatement");
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_free_statement);
        msg.addInt(statement.handle);
        msg.addInt(Const.DSQL_close);
        this._queueEvent(callback, true);
      }
      allocateAndPrepareStatement(transaction, query, plan, callback) {
        var self2 = this;
        var mainCallback = function(err, ret) {
          if (!err) {
            mainCallback.response.handle = ret.handle;
            describe(ret.buffer, mainCallback.response);
            mainCallback.response.query = query;
            self2.db.emit("query", query);
            ret = mainCallback.response;
            self2._setcachedquery(query, ret);
          }
          if (callback)
            callback(err, ret);
        };
        this._pending.push("allocateAndPrepareStatement");
        var msg = this._msg;
        var blr = this._blr;
        msg.pos = 0;
        blr.pos = 0;
        msg.addInt(Const.op_allocate_statement);
        msg.addInt(this.dbhandle);
        mainCallback.lazy_count = 1;
        blr.addBytes(Const.DESCRIBE);
        if (plan)
          blr.addByte(Const.isc_info_sql_get_plan);
        msg.addInt(Const.op_prepare_statement);
        msg.addInt(transaction.handle);
        msg.addInt(65535);
        msg.addInt(3);
        msg.addString(query, Const.DEFAULT_ENCODING);
        msg.addBlr(blr);
        msg.addInt(65535);
        mainCallback.lazy_count += 1;
        mainCallback.response = new Statement(this);
        this._queueEvent(mainCallback);
      }
      prepare(transaction, query, plan, callback) {
        var self2 = this;
        if (this.accept.protocolMinimumType === Const.ptype_lazy_send) {
          self2.allocateAndPrepareStatement(transaction, query, plan, callback);
        } else {
          self2.allocateStatement(function(err, statement) {
            if (err) {
              doError(err, callback);
              return;
            }
            self2.prepareStatement(transaction, statement, query, plan, callback);
          });
        }
      }
      prepareStatement(transaction, statement, query, plan, callback) {
        if (this._isClosed)
          return this.throwClosed(callback);
        var msg = this._msg;
        var blr = this._blr;
        msg.pos = 0;
        blr.pos = 0;
        if (plan instanceof Function) {
          callback = plan;
          plan = false;
        }
        blr.addBytes(Const.DESCRIBE);
        if (plan)
          blr.addByte(Const.isc_info_sql_get_plan);
        msg.addInt(Const.op_prepare_statement);
        msg.addInt(transaction.handle);
        msg.addInt(statement.handle);
        msg.addInt(3);
        msg.addString(query, Const.DEFAULT_ENCODING);
        msg.addBlr(blr);
        msg.addInt(65535);
        var self2 = this;
        this._queueEvent(function(err, ret) {
          if (!err) {
            describe(ret.buffer, statement);
            statement.query = query;
            self2.db.emit("query", query);
            ret = statement;
            self2._setcachedquery(query, ret);
          }
          if (callback)
            callback(err, ret);
        });
      }
      executeStatement(transaction, statement, params, callback, custom2) {
        if (this._isClosed)
          return this.throwClosed(callback);
        this._pending.push("executeStatement");
        if (params instanceof Function) {
          callback = params;
          params = void 0;
        }
        var self2 = this;
        var op = Const.op_execute;
        if (this.accept.protocolVersion >= Const.PROTOCOL_VERSION13 && statement.type === Const.isc_info_sql_stmt_exec_procedure && statement.output.length) {
          op = Const.op_execute2;
        }
        function PrepareParams(params2, input2, callback2) {
          var value, meta;
          var ret = new Array(params2.length);
          var wait = params2.length;
          function done() {
            wait--;
            if (wait === 0)
              callback2(ret);
          }
          function putBlobData(index, value2, callback3) {
            self2.createBlob2(transaction, function(err, blob) {
              var b;
              var isStream = value2.readable;
              if (Buffer.isBuffer(value2))
                b = value2;
              else if (typeof value2 === "string")
                b = Buffer.from(value2, Const.DEFAULT_ENCODING);
              else if (!isStream)
                b = Buffer.from(JSON.stringify(value2), Const.DEFAULT_ENCODING);
              var chunkSize = self2.options.blobChunkSize || 1024;
              if (Buffer.isBuffer(b)) {
                bufferReader(b, chunkSize, function(b2, next) {
                  self2.batchSegments(blob, b2, next);
                }, function() {
                  ret[index] = new Xsql.SQLParamQuad(blob.oid);
                  self2.closeBlob(blob, callback3);
                });
                return;
              }
              var isReading = false;
              var isEnd = false;
              value2.on("data", function(chunk) {
                if (chunk.length <= chunkSize) {
                  self2.batchSegments(blob, chunk, function() {
                    if (isEnd && !isReading) {
                      ret[index] = new Xsql.SQLParamQuad(blob.oid);
                      self2.closeBlob(blob, callback3);
                    }
                  });
                  return;
                }
                value2.pause();
                isReading = true;
                bufferReader(chunk, chunkSize, function(b2, next) {
                  self2.batchSegments(blob, b2, next);
                }, function() {
                  isReading = false;
                  if (isEnd) {
                    ret[index] = new Xsql.SQLParamQuad(blob.oid);
                    self2.closeBlob(blob, callback3);
                  } else
                    value2.resume();
                });
              });
              value2.on("end", function() {
                isEnd = true;
                if (isReading)
                  return;
                if (!isReading) {
                  ret[index] = new Xsql.SQLParamQuad(blob.oid);
                  self2.closeBlob(blob, callback3);
                }
              });
            });
          }
          for (var i = 0, length = params2.length; i < length; i++) {
            value = params2[i];
            meta = input2[i];
            if (value === null || value === void 0) {
              switch (meta.type) {
                case Const.SQL_VARYING:
                case Const.SQL_NULL:
                case Const.SQL_TEXT:
                  ret[i] = new Xsql.SQLParamString(null);
                  break;
                case Const.SQL_DOUBLE:
                case Const.SQL_FLOAT:
                case Const.SQL_D_FLOAT:
                  ret[i] = new Xsql.SQLParamDouble(null);
                  break;
                case Const.SQL_TYPE_DATE:
                case Const.SQL_TYPE_TIME:
                case Const.SQL_TIMESTAMP:
                  ret[i] = new Xsql.SQLParamDate(null);
                  break;
                case Const.SQL_BLOB:
                case Const.SQL_ARRAY:
                case Const.SQL_QUAD:
                  ret[i] = new Xsql.SQLParamQuad(null);
                  break;
                case Const.SQL_LONG:
                case Const.SQL_SHORT:
                case Const.SQL_INT64:
                case Const.SQL_BOOLEAN:
                  ret[i] = new Xsql.SQLParamInt(null);
                  break;
                default:
                  ret[i] = null;
              }
              done();
            } else {
              switch (meta.type) {
                case Const.SQL_BLOB:
                  putBlobData(i, value, done);
                  break;
                case Const.SQL_TIMESTAMP:
                case Const.SQL_TYPE_DATE:
                case Const.SQL_TYPE_TIME:
                  if (value instanceof Date)
                    ret[i] = new Xsql.SQLParamDate(value);
                  else if (typeof value === "string")
                    ret[i] = new Xsql.SQLParamDate(parseDate(value));
                  else
                    ret[i] = new Xsql.SQLParamDate(new Date(value));
                  done();
                  break;
                default:
                  switch (typeof value) {
                    case "bigint":
                      ret[i] = new Xsql.SQLParamInt128(value);
                      break;
                    case "number":
                      if (value % 1 === 0) {
                        if (value >= Const.MIN_INT && value <= Const.MAX_INT)
                          ret[i] = new Xsql.SQLParamInt(value);
                        else
                          ret[i] = new Xsql.SQLParamInt64(value);
                      } else
                        ret[i] = new Xsql.SQLParamDouble(value);
                      break;
                    case "string":
                      ret[i] = new Xsql.SQLParamString(value);
                      break;
                    case "boolean":
                      ret[i] = new Xsql.SQLParamBool(value);
                      break;
                    default:
                      ret[i] = new Xsql.SQLParamString(value.toString());
                      break;
                  }
                  done();
              }
            }
          }
        }
        var input = statement.input;
        if (input.length) {
          if (!(params instanceof Array)) {
            if (params !== void 0)
              params = [params];
            else
              params = [];
          }
          if (params.length !== input.length) {
            self2._pending.pop();
            callback(new Error("Expected parameters: (params=" + params.length + " vs. expected=" + input.length + ") - " + statement.query));
            return;
          }
          PrepareParams(params, input, function(prms) {
            self2.sendExecute(op, statement, transaction, callback, prms);
          });
          return;
        }
        this.sendExecute(op, statement, transaction, callback);
      }
      sendExecute(op, statement, transaction, callback, parameters) {
        var msg = this._msg;
        var blr = this._blr;
        msg.pos = 0;
        blr.pos = 0;
        msg.addInt(op);
        msg.addInt(statement.handle);
        msg.addInt(transaction.handle);
        if (parameters && parameters.length) {
          CalcBlr(blr, parameters);
          msg.addBlr(blr);
          msg.addInt(0);
          msg.addInt(1);
          if (this.accept.protocolVersion >= Const.PROTOCOL_VERSION13) {
            var nullBits = new BitSet();
            for (var i = 0; i < parameters.length; i++) {
              nullBits.set(i, parameters[i].value === null & 1);
            }
            var nullBuffer = nullBits.toBuffer();
            var requireBytes = Math.floor((parameters.length + 7) / 8);
            var remainingBytes = requireBytes - nullBuffer.length;
            if (nullBuffer.length) {
              msg.addBuffer(nullBuffer);
            }
            if (remainingBytes > 0) {
              msg.addBuffer(Buffer.alloc(remainingBytes));
            }
            msg.addAlignment(requireBytes);
            for (var i = 0; i < parameters.length; i++) {
              if (parameters[i].value !== null) {
                parameters[i].encode(msg);
              }
            }
          } else {
            for (var i = 0; i < parameters.length; i++) {
              parameters[i].encode(msg);
              if (parameters[i].value !== null) {
                msg.addInt(0);
              }
            }
          }
        } else {
          msg.addBlr(blr);
          msg.addInt(0);
          msg.addInt(0);
        }
        if (op === Const.op_execute2) {
          var outputBlr = new BlrWriter(32);
          if (statement.output && statement.output.length) {
            CalcBlr(outputBlr, statement.output);
            msg.addBlr(outputBlr);
          } else {
            msg.addBlr(outputBlr);
          }
          msg.addInt(0);
        }
        callback.statement = statement;
        this._queueEvent(callback);
      }
      fetch(statement, transaction, count, callback) {
        var msg = this._msg;
        var blr = this._blr;
        msg.pos = 0;
        blr.pos = 0;
        if (count instanceof Function) {
          callback = count;
          count = Const.DEFAULT_FETCHSIZE;
        }
        msg.addInt(Const.op_fetch);
        msg.addInt(statement.handle);
        CalcBlr(blr, statement.output);
        msg.addBlr(blr);
        msg.addInt(0);
        msg.addInt(count || Const.DEFAULT_FETCHSIZE);
        callback.statement = statement;
        this._queueEvent(callback);
      }
      fetchAll(statement, transaction, callback) {
        const self2 = this;
        const custom2 = statement.custom || {};
        const asStream = custom2.asStream && custom2.on;
        const data = asStream ? null : [];
        let streamIndex = 0;
        const loop = (err, ret) => {
          if (err) {
            callback(err);
            return;
          }
          if (ret && ret.data && ret.data.length) {
            const arrPromise = (ret.arrBlob || []).map((value) => value(transaction));
            Promise.all(arrPromise).then((arrBlob) => {
              for (let i = 0; i < arrBlob.length; i++) {
                const blob = arrBlob[i];
                ret.data[blob.row][blob.column] = blob.value;
              }
              doSynchronousLoop(ret.data, (row, _i, next) => {
                const pos = asStream ? streamIndex++ : data.push(row) - 1;
                if (asStream) {
                  executeStreamRow(custom2, row, pos, statement.output, next);
                } else {
                  next();
                }
              }, (streamErr) => {
                if (streamErr) {
                  callback(streamErr);
                  return;
                }
                if (ret.fetched) {
                  callback(void 0, data || []);
                } else {
                  self2.fetch(statement, transaction, Const.DEFAULT_FETCHSIZE, loop);
                }
              });
            }).catch(callback);
            return;
          }
          if (ret && ret.fetched) {
            callback(void 0, data || []);
          } else {
            self2.fetch(statement, transaction, Const.DEFAULT_FETCHSIZE, loop);
          }
        };
        this.fetch(statement, transaction, Const.DEFAULT_FETCHSIZE, loop);
      }
      openBlob(blob, transaction, callback) {
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_open_blob);
        msg.addInt(transaction.handle);
        msg.addQuad(blob);
        this._queueEvent(callback);
      }
      closeBlob(blob, callback) {
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_close_blob);
        msg.addInt(blob.handle);
        this._queueEvent(callback, true);
      }
      getSegment(blob, callback) {
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_get_segment);
        msg.addInt(blob.handle);
        msg.addInt(1024);
        msg.addInt(0);
        this._queueEvent(callback);
      }
      createBlob2(transaction, callback) {
        var msg = this._msg;
        msg.pos = 0;
        msg.addInt(Const.op_create_blob2);
        msg.addInt(0);
        msg.addInt(transaction.handle);
        msg.addInt(0);
        msg.addInt(0);
        this._queueEvent(callback);
      }
      batchSegments(blob, buffer, callback) {
        var msg = this._msg;
        var blr = this._blr;
        msg.pos = 0;
        blr.pos = 0;
        msg.addInt(Const.op_batch_segments);
        msg.addInt(blob.handle);
        msg.addInt(buffer.length + 2);
        blr.addBuffer(buffer);
        msg.addBlr(blr);
        this._queueEvent(callback);
      }
      svcattach(options, callback, svc) {
        this._lowercase_keys = options.lowercase_keys || Const.DEFAULT_LOWERCASE_KEYS;
        var database = options.database || options.filename;
        var user = options.user || Const.DEFAULT_USER;
        var password = options.password || Const.DEFAULT_PASSWORD;
        var role = options.role;
        var msg = this._msg;
        var blr = this._blr;
        msg.pos = 0;
        blr.pos = 0;
        blr.addBytes([Const.isc_dpb_version2, Const.isc_dpb_version2]);
        blr.addString(Const.isc_dpb_lc_ctype, "UTF8", Const.DEFAULT_ENCODING);
        if (this.accept.protocolVersion >= Const.PROTOCOL_VERSION13) {
          blr.addByte(Const.isc_dpb_utf8_filename);
          blr.addByte(0);
        }
        blr.addString(Const.isc_dpb_user_name, user, Const.DEFAULT_ENCODING);
        blr.addString(Const.isc_dpb_password, password, Const.DEFAULT_ENCODING);
        blr.addByte(Const.isc_dpb_dummy_packet_interval);
        blr.addByte(4);
        blr.addBytes([120, 10, 0, 0]);
        if (role)
          blr.addString(Const.isc_dpb_sql_role_name, role, Const.DEFAULT_ENCODING);
        msg.addInt(Const.op_service_attach);
        msg.addInt(0);
        msg.addString(Const.DEFAULT_SVC_NAME, Const.DEFAULT_ENCODING);
        msg.addBlr(this._blr);
        var self2 = this;
        function cb2(err, ret) {
          if (err) {
            doError(err, callback);
            return;
          }
          self2.svchandle = ret.handle;
          if (callback)
            callback(void 0, ret);
        }
        if (svc) {
          svc.connection = this;
          cb2.response = svc;
        } else {
          cb2.response = new ServiceManager(this);
          cb2.response.removeAllListeners("error");
          cb2.response.on("error", noop2);
        }
        this._queueEvent(cb2);
      }
      svcstart(spbaction, callback) {
        var msg = this._msg;
        var blr = this._blr;
        msg.pos = 0;
        msg.addInt(Const.op_service_start);
        msg.addInt(this.svchandle);
        msg.addInt(0);
        msg.addBlr(spbaction);
        this._queueEvent(callback);
      }
      svcquery(spbquery, resultbuffersize, timeout, callback) {
        if (resultbuffersize > Const.MAX_BUFFER_SIZE) {
          doError(new Error("Buffer is too big"), callback);
          return;
        }
        var msg = this._msg;
        var blr = this._blr;
        msg.pos = 0;
        blr.pos = 0;
        blr.addByte(Const.isc_spb_current_version);
        msg.addInt(Const.op_service_info);
        msg.addInt(this.svchandle);
        msg.addInt(0);
        msg.addBlr(blr);
        blr.pos = 0;
        blr.addBytes(spbquery);
        msg.addBlr(blr);
        msg.addInt(resultbuffersize);
        this._queueEvent(callback);
      }
      svcdetach(callback) {
        var self2 = this;
        if (self2._isClosed)
          return;
        self2._isUsed = false;
        self2._isDetach = true;
        var msg = self2._msg;
        msg.pos = 0;
        msg.addInt(Const.op_service_detach);
        msg.addInt(this.svchandle);
        self2._queueEvent(function(err, ret) {
          delete self2.svchandle;
          if (callback)
            callback(err, ret);
        });
      }
      auxConnection(callback) {
        var self2 = this;
        if (self2._isClosed)
          return this.throwClosed(callback);
        var msg = self2._msg;
        msg.pos = 0;
        msg.addInt(Const.op_connect_request);
        msg.addInt(1);
        msg.addInt(self2.dbhandle);
        msg.addInt(0);
        function cb2(err, ret) {
          if (err) {
            doError(err, callback);
            return;
          }
          var socket_info = {
            family: ret.buffer.readInt16BE(0),
            port: ret.buffer.readUInt16BE(2),
            host: ret.buffer.readUInt8(4) + "." + ret.buffer.readUInt8(5) + "." + ret.buffer.readUInt8(6) + "." + ret.buffer.readUInt8(7)
          };
          callback(void 0, socket_info);
        }
        this._queueEvent(cb2);
      }
      queEvents(events, eventid, callback) {
        var self2 = this;
        console.log("[Connection] queEvents called, eventid:", eventid, "events:", Object.keys(events), "isClosed:", this._isClosed);
        if (this._isClosed)
          return this.throwClosed(callback);
        var msg = this._msg;
        var blr = this._blr;
        blr.pos = 0;
        msg.pos = 0;
        msg.addInt(Const.op_que_events);
        msg.addInt(this.dbhandle);
        blr.addByte(1);
        for (var event in events) {
          var event_buffer = Buffer.from(event, "UTF8");
          blr.addByte(event_buffer.length);
          blr.addBytes(event_buffer);
          blr.addInt32(events[event]);
        }
        msg.addBlr(blr);
        msg.addInt(0);
        msg.addInt(0);
        msg.addInt(eventid);
        console.log("[Connection] queEvents: Message prepared, queuing event");
        function cb2(err, ret) {
          console.log("[Connection] queEvents callback invoked, err:", err, "ret:", ret);
          if (err) {
            doError(err, callback);
            return;
          }
          callback(null, ret);
        }
        this._queueEvent(cb2);
        console.log("[Connection] queEvents: Event queued");
      }
      closeEvents(eventid, callback) {
        var self2 = this;
        console.log("[Connection] closeEvents called, eventid:", eventid, "isClosed:", this._isClosed);
        if (this._isClosed)
          return this.throwClosed(callback);
        var msg = self2._msg;
        msg.pos = 0;
        msg.addInt(Const.op_cancel_events);
        msg.addInt(self2.dbhandle);
        msg.addInt(eventid);
        function cb2(err, ret) {
          console.log("[Connection] closeEvents callback invoked, err:", err);
          if (err) {
            doError(err, callback);
            return;
          }
          callback(null);
        }
        this._queueEvent(cb2);
        console.log("[Connection] closeEvents: Event queued");
      }
    };
    function decodeResponse(data, callback, cnx, lowercase_keys, cb2) {
      try {
        do {
          var r = data.r || data.readInt();
        } while (r === Const.op_dummy);
        var item, op, response;
        switch (r) {
          case Const.op_response:
            if (callback) {
              response = callback.response || {};
            } else {
              response = {};
            }
            let loop = function(err) {
              if (err) {
                return cb2(err);
              } else {
                if (callback && callback.lazy_count) {
                  callback.lazy_count--;
                  if (callback.lazy_count > 0) {
                    r = data.readInt();
                    parseOpResponse(data, response, loop);
                  } else {
                    cb2(null, response);
                  }
                } else {
                  cb2(null, response);
                }
              }
            };
            return parseOpResponse(data, response, loop);
          case Const.op_fetch_response:
          case Const.op_sql_response:
            var statement = callback.statement;
            var output = statement.output;
            var custom2 = statement.custom || {};
            var isOpFetch = r === Const.op_fetch_response;
            var _xdrpos;
            statement.nbrowsfetched = statement.nbrowsfetched || 0;
            if (isOpFetch && data.fop) {
              data.readBuffer(68);
              op = data.readInt();
              data.fop = false;
              if (op === Const.op_response) {
                return parseOpResponse(data, {}, cb2);
              }
            }
            if (!isOpFetch) {
              data.fstatus = 0;
            }
            data.fstatus = data.fstatus !== void 0 ? data.fstatus : data.readInt();
            data.fcount = data.fcount !== void 0 ? data.fcount : data.readInt();
            data.fcolumn = data.fcolumn || 0;
            data.frow = data.frow || (custom2.asObject ? {} : new Array(output.length));
            data.frows = data.frows || [];
            if (custom2.asObject && !data.fcols) {
              if (lowercase_keys) {
                data.fcols = output.map((column) => column.alias.toLowerCase());
              } else {
                data.fcols = output.map((column) => column.alias);
              }
            }
            const arrBlob = [];
            const lowerV13 = statement.connection.accept.protocolVersion < Const.PROTOCOL_VERSION13;
            while (data.fcount && data.fstatus !== 100) {
              let nullBitSet;
              if (!lowerV13) {
                const nullBitsLen = Math.floor((output.length + 7) / 8);
                nullBitSet = new BitSet(data.readBuffer(nullBitsLen, false));
                data.readBuffer(4 - nullBitsLen & 3, false);
              }
              for (let length = output.length; data.fcolumn < length; data.fcolumn++) {
                item = output[data.fcolumn];
                if (!lowerV13 && nullBitSet.get(data.fcolumn)) {
                  if (custom2.asObject) {
                    data.frow[data.fcols[data.fcolumn]] = null;
                  } else {
                    data.frow[data.fcolumn] = null;
                  }
                  continue;
                }
                try {
                  _xdrpos = data.pos;
                  const key = custom2.asObject ? data.fcols[data.fcolumn] : data.fcolumn;
                  const row = data.frows.length;
                  let value = item.decode(data, lowerV13);
                  if (item.type === Const.SQL_BLOB && value !== null) {
                    if (item.subType === Const.isc_blob_text && cnx.options.blobAsText) {
                      value = fetch_blob_async_transaction(statement, value, key, row);
                      arrBlob.push(value);
                    } else {
                      value = fetch_blob_async(statement, value, key, row);
                    }
                  }
                  data.frow[key] = value;
                } catch (e) {
                  data.pos = _xdrpos;
                  data.r = r;
                  return cb2(new Error("Packet is not complete"));
                }
              }
              data.fcolumn = 0;
              statement.connection.db.emit("row", data.frow, statement.nbrowsfetched, custom2.asObject);
              data.frows.push(data.frow);
              data.frow = custom2.asObject ? {} : new Array(output.length);
              try {
                _xdrpos = data.pos;
                if (isOpFetch) {
                  delete data.fstatus;
                  delete data.fcount;
                  op = data.readInt();
                  if (op === Const.op_response) {
                    return parseOpResponse(data, {}, cb2);
                  }
                  data.fstatus = data.readInt();
                  data.fcount = data.readInt();
                } else {
                  data.fcount--;
                  if (r === Const.op_sql_response) {
                    op = data.readInt();
                    if (op === Const.op_response) {
                      parseOpResponse(data, {});
                    }
                  }
                }
              } catch (e) {
                if (_xdrpos === data.pos) {
                  data.fop = true;
                }
                data.r = r;
                return cb2(new Error("Packet is not complete"));
              }
              statement.nbrowsfetched++;
            }
            statement.connection.db.emit("result", data.frows, arrBlob);
            return cb2(null, { data: data.frows, fetched: Boolean(!isOpFetch || data.fstatus === 100), arrBlob });
          case Const.op_accept:
          case Const.op_cond_accept:
          case Const.op_accept_data:
            let accept = {
              protocolVersion: data.readInt(),
              protocolArchitecture: data.readInt(),
              protocolMinimumType: data.readInt(),
              compress: false,
              pluginName: "",
              authData: "",
              sessionKey: ""
            };
            accept.compress = (accept.protocolMinimumType & Const.pflag_compress) !== 0;
            accept.protocolMinimumType = accept.protocolMinimumType & Const.ptype_mask;
            if (accept.protocolVersion < 0) {
              accept.protocolVersion = accept.protocolVersion & Const.FB_PROTOCOL_MASK | Const.FB_PROTOCOL_FLAG;
            }
            if (r === Const.op_cond_accept || r === Const.op_accept_data) {
              var d = new BlrReader(data.readArray());
              accept.pluginName = data.readString(Const.DEFAULT_ENCODING);
              var is_authenticated = data.readInt();
              var keys = data.readString(Const.DEFAULT_ENCODING);
              if (is_authenticated === 0) {
                if (cnx.options.pluginName && cnx.options.pluginName !== accept.pluginName) {
                  doError(new Error("Server don't accept plugin : " + cnx.options.pluginName + ", but support : " + accept.pluginName), callback);
                }
                if (Const.AUTH_PLUGIN_SRP_LIST.indexOf(accept.pluginName) !== -1) {
                  var crypto = {
                    Srp: "sha1",
                    Srp256: "sha256"
                  };
                  accept.srpAlgo = crypto[accept.pluginName];
                  var saltLen = d.buffer.readUInt16LE(0);
                  if (saltLen > 32 * 2) {
                    console.log("salt to long");
                  }
                  var keyLen = d.buffer.readUInt16LE(saltLen + 2);
                  var keyStart = saltLen + 4;
                  if (d.buffer.length - keyStart !== keyLen) {
                    console.log("key error");
                  }
                  cnx.serverKeys = {
                    salt: d.buffer.slice(2, saltLen + 2).toString("utf8"),
                    public: BigInt2(d.buffer.slice(keyStart, d.buffer.length).toString("utf8"), 16)
                  };
                  var proof = srp.clientProof(
                    cnx.options.user.toUpperCase(),
                    cnx.options.password,
                    cnx.serverKeys.salt,
                    cnx.clientKeys.public,
                    cnx.serverKeys.public,
                    cnx.clientKeys.private,
                    accept.srpAlgo
                  );
                  accept.authData = proof.authData.toString(16);
                  accept.sessionKey = proof.clientSessionKey;
                } else if (accept.pluginName === Const.AUTH_PLUGIN_LEGACY) {
                  accept.authData = crypt.crypt(cnx.options.password, Const.LEGACY_AUTH_SALT).substring(2);
                } else {
                  return cb2(new Error("Unknow auth plugin : " + accept.pluginName));
                }
              } else {
                accept.authData = "";
                accept.sessionKey = "";
              }
            }
            if (accept.compress) {
              cnx._socket.enableCompression();
            }
            if (r === Const.op_cond_accept && accept.authData) {
              cnx._pendingAccept = accept;
              cnx.sendOpContAuth(
                accept.authData,
                Const.DEFAULT_ENCODING,
                accept.pluginName
              );
              return;
            }
            return cb2(void 0, accept);
          case Const.op_cont_auth:
            var d = new BlrReader(data.readArray());
            var pluginName = data.readString(Const.DEFAULT_ENCODING);
            data.readString(Const.DEFAULT_ENCODING);
            data.readString(Const.DEFAULT_ENCODING);
            if (!cnx.options.pluginName) {
              if (cnx.accept.pluginName === pluginName) {
                return cb2(new Error("Unable to connect with plugin " + cnx.accept.pluginName));
              }
              if (pluginName === Const.AUTH_PLUGIN_LEGACY) {
                cnx.accept.pluginName = pluginName;
                cnx.accept.authData = crypt.crypt(cnx.options.password, Const.LEGACY_AUTH_SALT).substring(2);
                cnx.sendOpContAuth(
                  cnx.accept.authData,
                  Const.DEFAULT_ENCODING,
                  pluginName
                );
                return { error: new Error("login") };
              }
            }
            return data.accept;
          case Const.op_crypt_key_callback:
            var serverPluginData = data.readArray();
            var clientPluginData = parseDbCryptConfig(cnx.options.dbCryptConfig);
            var responseBlr = new BlrWriter(clientPluginData.length + 4);
            responseBlr.addBytes(clientPluginData);
            cnx.sendOpCryptKeyCallback(responseBlr);
            return;
          default:
            return cb2(new Error("Unexpected:" + r));
        }
      } catch (err) {
        if (err instanceof RangeError) {
          return cb2(err);
        }
        throw err;
      }
    }
    function parseOpResponse(data, response, cb2) {
      var handle = data.readInt();
      if (!response.handle) {
        response.handle = handle;
      }
      var oid = data.readQuad();
      if (oid.low || oid.high) {
        response.oid = oid;
      }
      var buf = data.readArray();
      if (buf) {
        response.buffer = buf;
      }
      var num, op, item = {};
      while (true) {
        op = data.readInt();
        switch (op) {
          case Const.isc_arg_end:
            return cb2 ? cb2(void 0, response) : response;
          case Const.isc_arg_gds:
            num = data.readInt();
            if (!num) {
              break;
            }
            item = { gdscode: num };
            if (response.status) {
              response.status.push(item);
            } else {
              response.status = [item];
            }
            break;
          case Const.isc_arg_string:
          case Const.isc_arg_interpreted:
          case Const.isc_arg_sql_state:
            if (item.params) {
              var str = data.readString(Const.DEFAULT_ENCODING);
              item.params.push(str);
            } else {
              item.params = [data.readString(Const.DEFAULT_ENCODING)];
            }
            break;
          case Const.isc_arg_number:
            num = data.readInt();
            if (item.params) {
              item.params.push(num);
            } else {
              item.params = [num];
            }
            if (item.gdscode === Const.isc_sqlerr) {
              response.sqlcode = num;
            }
            break;
          default:
            if (cb2) {
              cb2(new Error("Unexpected: " + op));
            } else {
              throw new Error("Unexpected: " + op);
            }
        }
      }
    }
    function describe(buff, statement) {
      var br = new BlrReader(buff);
      var parameters = null;
      var type, param;
      while (br.pos < br.buffer.length) {
        switch (br.readByteCode()) {
          case Const.isc_info_sql_stmt_type:
            statement.type = br.readInt();
            break;
          case Const.isc_info_sql_get_plan:
            statement.plan = br.readString(Const.DEFAULT_ENCODING);
            break;
          case Const.isc_info_sql_select:
            statement.output = parameters = [];
            break;
          case Const.isc_info_sql_bind:
            statement.input = parameters = [];
            break;
          case Const.isc_info_sql_num_variables:
            br.readInt();
            break;
          case Const.isc_info_sql_describe_vars:
            if (!parameters) {
              return;
            }
            br.readInt();
            var finishDescribe = false;
            param = null;
            while (!finishDescribe) {
              switch (br.readByteCode()) {
                case Const.isc_info_sql_describe_end:
                  break;
                case Const.isc_info_sql_sqlda_seq:
                  var num = br.readInt();
                  break;
                case Const.isc_info_sql_type:
                  type = br.readInt();
                  switch (type & ~1) {
                    case Const.SQL_VARYING:
                      param = new Xsql.SQLVarString();
                      break;
                    case Const.SQL_NULL:
                      param = new Xsql.SQLVarNull();
                      break;
                    case Const.SQL_TEXT:
                      param = new Xsql.SQLVarText();
                      break;
                    case Const.SQL_DOUBLE:
                      param = new Xsql.SQLVarDouble();
                      break;
                    case Const.SQL_FLOAT:
                    case Const.SQL_D_FLOAT:
                      param = new Xsql.SQLVarFloat();
                      break;
                    case Const.SQL_TYPE_DATE:
                      param = new Xsql.SQLVarDate();
                      break;
                    case Const.SQL_TYPE_TIME:
                      param = new Xsql.SQLVarTime();
                      break;
                    case Const.SQL_TIMESTAMP:
                      param = new Xsql.SQLVarTimeStamp();
                      break;
                    case Const.SQL_BLOB:
                      param = new Xsql.SQLVarBlob();
                      break;
                    case Const.SQL_ARRAY:
                      param = new Xsql.SQLVarArray();
                      break;
                    case Const.SQL_QUAD:
                      param = new Xsql.SQLVarQuad();
                      break;
                    case Const.SQL_LONG:
                      param = new Xsql.SQLVarInt();
                      break;
                    case Const.SQL_SHORT:
                      param = new Xsql.SQLVarShort();
                      break;
                    case Const.SQL_INT64:
                      param = new Xsql.SQLVarInt64();
                      break;
                    case Const.SQL_INT128:
                      param = new Xsql.SQLVarInt128();
                      break;
                    case Const.SQL_BOOLEAN:
                      param = new Xsql.SQLVarBoolean();
                      break;
                    default:
                      throw new Error("Unexpected");
                  }
                  parameters[num - 1] = param;
                  param.type = type;
                  param.nullable = Boolean(param.type & 1);
                  param.type &= ~1;
                  break;
                case Const.isc_info_sql_sub_type:
                  param.subType = br.readInt();
                  break;
                case Const.isc_info_sql_scale:
                  param.scale = br.readInt();
                  break;
                case Const.isc_info_sql_length:
                  param.length = br.readInt();
                  break;
                case Const.isc_info_sql_null_ind:
                  param.nullable = Boolean(br.readInt());
                  break;
                case Const.isc_info_sql_field:
                  param.field = br.readString(Const.DEFAULT_ENCODING);
                  break;
                case Const.isc_info_sql_relation:
                  param.relation = br.readString(Const.DEFAULT_ENCODING);
                  break;
                case Const.isc_info_sql_owner:
                  param.owner = br.readString(Const.DEFAULT_ENCODING);
                  break;
                case Const.isc_info_sql_alias:
                  param.alias = br.readString(Const.DEFAULT_ENCODING);
                  break;
                case Const.isc_info_sql_relation_alias:
                  param.relationAlias = br.readString(Const.DEFAULT_ENCODING);
                  break;
                case Const.isc_info_truncated:
                  throw new Error("Truncated");
                default:
                  finishDescribe = true;
                  br.pos--;
              }
            }
        }
      }
    }
    function CalcBlr(blr, xsqlda) {
      blr.addBytes([Const.blr_version5, Const.blr_begin, Const.blr_message, 0]);
      blr.addWord(xsqlda.length * 2);
      for (var i = 0, length = xsqlda.length; i < length; i++) {
        xsqlda[i].calcBlr(blr);
        blr.addByte(Const.blr_short);
        blr.addByte(0);
      }
      blr.addByte(Const.blr_end);
      blr.addByte(Const.blr_eoc);
    }
    function fetch_blob_async_transaction(statement, id, column, row) {
      const infoValue = { row, column, value: "" };
      return (transactionArg) => {
        const singleTransaction = transactionArg === void 0;
        let promiseTransaction;
        if (singleTransaction) {
          promiseTransaction = new Promise((resolve5, reject) => {
            statement.connection.startTransaction(Const.ISOLATION_READ_UNCOMMITTED, (err, transaction) => {
              if (err) {
                return reject(err);
              }
              resolve5(transaction);
            });
          });
        } else {
          promiseTransaction = Promise.resolve(transactionArg);
        }
        return promiseTransaction.then((transaction) => {
          return new Promise((resolve5, reject) => {
            statement.connection._pending.push("openBlob");
            statement.connection.openBlob(id, transaction, (err, blob) => {
              if (err) {
                reject(err);
                return;
              }
              const read = () => {
                statement.connection.getSegment(blob, (err2, ret) => {
                  if (err2) {
                    if (singleTransaction) {
                      transaction.rollback(() => reject(err2));
                    } else {
                      reject(err2);
                    }
                    return;
                  }
                  if (ret.buffer) {
                    const blr = new BlrReader(ret.buffer);
                    const data = blr.readSegment();
                    infoValue.value += data.toString(Const.DEFAULT_ENCODING);
                  }
                  if (ret.handle !== 2) {
                    read();
                    return;
                  }
                  statement.connection.closeBlob(blob);
                  if (singleTransaction) {
                    transaction.commit((err3) => {
                      if (err3) {
                        reject(err3);
                      } else {
                        resolve5(infoValue);
                      }
                    });
                  } else {
                    resolve5(infoValue);
                  }
                });
              };
              read();
            });
          });
        });
      };
    }
    function fetch_blob_async(statement, id, name, row) {
      const cbTransaction = (transaction, close, callback) => {
        statement.connection._pending.push("openBlob");
        statement.connection.openBlob(id, transaction, (err, blob) => {
          let e = new Events.EventEmitter();
          e.pipe = (stream) => {
            e.on("data", (chunk) => {
              stream.write(chunk);
            });
            e.on("end", () => {
              stream.end();
            });
          };
          if (err) {
            return callback(err, name, e, row);
          }
          const read = () => {
            statement.connection.getSegment(blob, (err2, ret) => {
              if (err2) {
                transaction.rollback(() => {
                  e.emit("error", err2);
                });
                return;
              }
              if (ret.buffer) {
                const blr = new BlrReader(ret.buffer);
                const data = blr.readSegment();
                e.emit("data", data);
              }
              if (ret.handle !== 2) {
                read();
                return;
              }
              statement.connection.closeBlob(blob);
              if (close) {
                transaction.commit((err3) => {
                  if (err3) {
                    e.emit("error", err3);
                  } else {
                    e.emit("end");
                  }
                  e = null;
                });
              } else {
                e.emit("end");
                e = null;
              }
            });
          };
          callback(err, name, e, row);
          read();
        });
      };
      return (transaction, callback) => {
        const singleTransaction = callback === void 0;
        if (singleTransaction) {
          callback = transaction;
          statement.connection.startTransaction(Const.ISOLATION_READ_UNCOMMITTED, (err, transaction2) => {
            if (err) {
              callback(err);
              return;
            }
            cbTransaction(transaction2, singleTransaction, callback);
          });
        } else {
          cbTransaction(transaction, singleTransaction, callback);
        }
      };
    }
    function doSynchronousLoop(data, processData, done) {
      if (!data || !data.length) {
        done();
        return;
      }
      const loop = (index) => {
        processData(data[index], index, (err) => {
          if (err) {
            done(err);
            return;
          }
          const nextIndex = index + 1;
          if (nextIndex < data.length) {
            loop(nextIndex);
          } else {
            done();
          }
        });
      };
      loop(0);
    }
    function executeStreamRow(custom2, row, index, output, next) {
      let done = false;
      const finish = (err) => {
        if (done) {
          return;
        }
        done = true;
        next(err);
      };
      try {
        const ret = custom2.on(row, index, output, finish);
        if (custom2.on.length < 4) {
          if (ret && typeof ret.then === "function") {
            ret.then(() => finish()).catch(finish);
          } else {
            finish();
          }
        } else if (ret && typeof ret.then === "function") {
          ret.catch(finish);
        }
      } catch (err) {
        finish(err);
      }
    }
    function bufferReader(buffer, max, writer, cb2, beg, end) {
      if (!beg)
        beg = 0;
      if (!end)
        end = max;
      if (end >= buffer.length)
        end = void 0;
      var b = buffer.slice(beg, end);
      writer(b, function() {
        if (end === void 0) {
          cb2();
          return;
        }
        bufferReader(buffer, max, writer, cb2, beg + max, end + max);
      });
    }
    function parseDbCryptConfig(config) {
      if (!config) {
        return Buffer.alloc(0);
      }
      if (config.startsWith("base64:")) {
        const base64Value = config.substring(7);
        try {
          return Buffer.from(base64Value, "base64");
        } catch (e) {
          console.error("Failed to decode base64 dbCryptConfig, returning empty buffer:", e);
          return Buffer.alloc(0);
        }
      }
      return Buffer.from(config, "utf8");
    }
    module2.exports = Connection;
  }
});

// ../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/pool.js
var require_pool = __commonJS({
  "../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/pool.js"(exports2, module2) {
    var Pool = class {
      constructor(attach, max, options) {
        this.attach = attach;
        this.internaldb = [];
        this.pooldb = [];
        this.dbinuse = 0;
        this._creating = 0;
        this.max = max || 4;
        this.pending = [];
        this.options = options;
      }
      get(callback) {
        var self2 = this;
        self2.pending.push(callback);
        self2.check();
        return self2;
      }
      check() {
        var self2 = this;
        if (self2.dbinuse + self2._creating >= self2.max)
          return self2;
        var cb2 = self2.pending.shift();
        if (!cb2)
          return self2;
        if (self2.pooldb.length) {
          self2.dbinuse++;
          cb2(null, self2.pooldb.shift());
        } else {
          self2._creating++;
          this.attach(self2.options, function(err, db) {
            self2._creating--;
            if (!err) {
              self2.dbinuse++;
              self2.internaldb.push(db);
              db.on("detach", function() {
                if (self2.pooldb.indexOf(db) !== -1 || self2.internaldb.indexOf(db) === -1)
                  return;
                if (db.connection._isClosed || db.connection._isDetach || db.connection._pooled === false)
                  self2.internaldb.splice(self2.internaldb.indexOf(db), 1);
                else
                  self2.pooldb.push(db);
                self2.dbinuse--;
                self2.check();
              });
            }
            cb2(err, db);
          });
        }
        setImmediate(function() {
          self2.check();
        });
        return self2;
      }
      destroy(callback) {
        var self2 = this;
        var connectionCount = this.internaldb.length;
        if (connectionCount === 0 && callback) {
          callback();
        }
        function detachCallback(err) {
          if (err) {
            if (callback) {
              callback(err);
            }
            return;
          }
          connectionCount--;
          if (connectionCount === 0 && callback) {
            callback();
          }
        }
        this.internaldb.forEach(function(db) {
          if (db.connection._pooled === false) {
            detachCallback();
            return;
          }
          var _db_in_pool = self2.pooldb.indexOf(db);
          if (_db_in_pool !== -1) {
            self2.pooldb.splice(_db_in_pool, 1);
            db.connection._pooled = false;
            db.detach(detachCallback);
          }
        });
      }
    };
    module2.exports = Pool;
  }
});

// ../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/index.js
var require_lib = __commonJS({
  "../node_modules/.pnpm/node-firebird@2.0.2/node_modules/node-firebird/lib/index.js"(exports2) {
    var Const = require_const();
    var { doError, doCallback } = require_callback();
    var Connection = require_connection();
    var Pool = require_pool();
    var { escape } = require_utils();
    if (typeof setImmediate === "undefined") {
      global.setImmediate = function(cb2) {
        process.nextTick(cb2);
      };
    }
    exports2.AUTH_PLUGIN_LEGACY = Const.AUTH_PLUGIN_LEGACY;
    exports2.AUTH_PLUGIN_SRP = Const.AUTH_PLUGIN_SRP;
    exports2.AUTH_PLUGIN_SRP256 = Const.AUTH_PLUGIN_SRP256;
    exports2.WIRE_CRYPT_DISABLE = Const.WIRE_CRYPT_DISABLE;
    exports2.WIRE_CRYPT_ENABLE = Const.WIRE_CRYPT_ENABLE;
    exports2.ISOLATION_READ_UNCOMMITTED = Const.ISOLATION_READ_UNCOMMITTED;
    exports2.ISOLATION_READ_COMMITTED = Const.ISOLATION_READ_COMMITTED;
    exports2.ISOLATION_REPEATABLE_READ = Const.ISOLATION_REPEATABLE_READ;
    exports2.ISOLATION_SERIALIZABLE = Const.ISOLATION_SERIALIZABLE;
    exports2.ISOLATION_READ_COMMITTED_READ_ONLY = Const.ISOLATION_READ_COMMITTED_READ_ONLY;
    if (!String.prototype.padLeft) {
      String.prototype.padLeft = function(max, c) {
        var self2 = this;
        return new Array(Math.max(0, max - self2.length + 1)).join(c || " ") + self2;
      };
    }
    exports2.escape = escape;
    exports2.attach = function(options, callback) {
      var host = options.host || Const.DEFAULT_HOST;
      var port = options.port || Const.DEFAULT_PORT;
      var manager = options.manager || false;
      var cnx = this.connection = new Connection(host, port, function(err) {
        if (err) {
          doError(err, callback);
          return;
        }
        cnx.connect(options, function(err2) {
          if (err2) {
            doError(err2, callback);
          } else {
            if (manager)
              cnx.svcattach(options, callback);
            else
              cnx.attach(options, callback);
          }
        });
      }, options);
    };
    exports2.drop = function(options, callback) {
      exports2.attach(options, function(err, db) {
        if (err) {
          callback({ error: err, message: "Drop error" });
          return;
        }
        db.drop(callback);
      });
    };
    exports2.create = function(options, callback) {
      var host = options.host || Const.DEFAULT_HOST;
      var port = options.port || Const.DEFAULT_PORT;
      var cnx = this.connection = new Connection(host, port, function(err) {
        var self2 = cnx;
        if (err) {
          callback({ error: err, message: "Connect error" });
          return;
        }
        cnx.connect(options, function(err2) {
          if (err2) {
            self2.db.emit("error", err2);
            doError(err2, callback);
            return;
          }
          cnx.createDatabase(options, callback);
        });
      }, options);
    };
    exports2.attachOrCreate = function(options, callback) {
      var host = options.host || Const.DEFAULT_HOST;
      var port = options.port || Const.DEFAULT_PORT;
      var cnx = this.connection = new Connection(host, port, function(err) {
        var self2 = cnx;
        if (err) {
          callback({ error: err, message: "Connect error" });
          return;
        }
        cnx.connect(options, function(err2) {
          if (err2) {
            doError(err2, callback);
            return;
          }
          cnx.attach(options, function(err3, ret) {
            if (!err3) {
              if (self2.db)
                self2.db.emit("connect", ret);
              doCallback(ret, callback);
              return;
            }
            cnx.createDatabase(options, callback);
          });
        });
      }, options);
    };
    exports2.pool = function(max, options) {
      return new Pool(exports2.attach, max, Object.assign({}, options, { isPool: true }));
    };
  }
});

// src/index.ts
var import_node_fs4 = require("node:fs");
var import_node_path4 = require("node:path");

// src/config.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");

// ../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: (arg) => ZodString.create({ ...arg, coerce: true }),
  number: (arg) => ZodNumber.create({ ...arg, coerce: true }),
  boolean: (arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  }),
  bigint: (arg) => ZodBigInt.create({ ...arg, coerce: true }),
  date: (arg) => ZodDate.create({ ...arg, coerce: true })
};
var NEVER = INVALID;

// src/config.ts
var ConfigSchema = external_exports.object({
  api: external_exports.object({
    url: external_exports.string().url(),
    token: external_exports.string().startsWith("agt_")
  }),
  firebird: external_exports.object({
    host: external_exports.string(),
    port: external_exports.number().int().default(3050),
    database: external_exports.string(),
    user: external_exports.string().default("SYSDBA"),
    password: external_exports.string()
  }),
  /** Intervalo entre sincronizacoes em segundos. */
  intervalSeconds: external_exports.number().int().min(60).default(900),
  /** Tamanho maximo do batch enviado por POST. */
  batchSize: external_exports.number().int().min(1).max(2e3).default(500),
  /** Caminho do arquivo de checkpoint local. */
  checkpointFile: external_exports.string().default("checkpoint.json"),
  /** Janela de re-sincronizacao de PEDIDOS/ITENSPEDIDO em dias.
   *  Pedidos abertos dentro dessa janela sao re-buscados a cada ciclo
   *  e UPSERT no banco — captura updates pos-criacao (data_fechamento,
   *  valor_total, total_servico) que o cursor incremental por CODIGO
   *  perdia. Default 7 dias = uma semana operacional. */
  refetchJanelaDias: external_exports.number().int().min(0).max(60).default(14)
});
function configPath() {
  if (process.env.CONCILIA_CONFIG) return (0, import_node_path.resolve)(process.env.CONCILIA_CONFIG);
  return (0, import_node_path.resolve)(process.cwd(), "config.json");
}
function loadConfig() {
  const path = configPath();
  let raw;
  try {
    raw = (0, import_node_fs.readFileSync)(path, "utf8");
  } catch (e) {
    throw new Error(`Nao foi possivel ler config em ${path}. ${e.message}`);
  }
  const cleaned = raw.charCodeAt(0) === 65279 ? raw.slice(1) : raw;
  let json;
  try {
    json = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`config.json invalido: ${e.message}`);
  }
  const parsed = ConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`config.json com erros: ${JSON.stringify(parsed.error.flatten(), null, 2)}`);
  }
  return parsed.data;
}

// src/checkpoint.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
var Checkpoint = class {
  path;
  data;
  constructor(file) {
    this.path = (0, import_node_path2.resolve)(process.cwd(), file);
    this.data = this.load();
  }
  load() {
    if (!(0, import_node_fs2.existsSync)(this.path)) {
      return { ultimoCodigo: 0, ultimaSincronizacao: null, totalSincronizados: 0, porEntidade: {} };
    }
    try {
      const raw = (0, import_node_fs2.readFileSync)(this.path, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed.porEntidade) parsed.porEntidade = {};
      return parsed;
    } catch {
      return { ultimoCodigo: 0, ultimaSincronizacao: null, totalSincronizados: 0, porEntidade: {} };
    }
  }
  save() {
    (0, import_node_fs2.writeFileSync)(this.path, JSON.stringify(this.data, null, 2), "utf8");
  }
  get() {
    return { ...this.data };
  }
  /** Ultimo codigo de uma entidade. Pagamentos usa ultimoCodigo antigo pra compat. */
  getUltimoCodigo(entidade) {
    if (entidade === "pagamentos") {
      return this.data.porEntidade?.pagamentos?.ultimoCodigo ?? this.data.ultimoCodigo ?? 0;
    }
    return this.data.porEntidade?.[entidade]?.ultimoCodigo ?? 0;
  }
  /** Atualiza pagamentos (mantem compat com campos antigos). */
  update(novoUltimo, qtdNova) {
    if (novoUltimo > this.data.ultimoCodigo) this.data.ultimoCodigo = novoUltimo;
    this.data.ultimaSincronizacao = (/* @__PURE__ */ new Date()).toISOString();
    this.data.totalSincronizados += qtdNova;
    this.data.porEntidade ??= {};
    const prev = this.data.porEntidade.pagamentos ?? { ultimoCodigo: 0, total: 0 };
    this.data.porEntidade.pagamentos = {
      ultimoCodigo: Math.max(prev.ultimoCodigo, novoUltimo),
      total: prev.total + qtdNova
    };
    this.save();
  }
  /** Atualiza entidade financeira. */
  updateEntidade(entidade, novoUltimo, qtdNova) {
    this.data.porEntidade ??= {};
    const prev = this.data.porEntidade[entidade] ?? { ultimoCodigo: 0, total: 0 };
    this.data.porEntidade[entidade] = {
      ultimoCodigo: Math.max(prev.ultimoCodigo, novoUltimo),
      total: prev.total + qtdNova
    };
    this.data.ultimaSincronizacao = (/* @__PURE__ */ new Date()).toISOString();
    this.save();
  }
};

// src/firebird.ts
var import_node_firebird = __toESM(require_lib(), 1);
function executarQuery(cfg, sql, params) {
  const opts = {
    host: cfg.firebird.host,
    port: cfg.firebird.port,
    database: cfg.firebird.database,
    user: cfg.firebird.user,
    password: cfg.firebird.password,
    lowercase_keys: false,
    pageSize: 4096
  };
  const inner = new Promise((resolve5, reject) => {
    let resolved = false;
    const safeResolve = (v) => {
      if (resolved) return;
      resolved = true;
      resolve5(v);
    };
    const safeReject = (e) => {
      if (resolved) return;
      resolved = true;
      reject(e);
    };
    import_node_firebird.default.attach(opts, (err, db) => {
      if (err) return safeReject(err);
      db.query(sql, params, (e, rows) => {
        if (e) {
          try {
            db.detach(() => {
            });
          } catch {
          }
          return safeReject(e);
        }
        safeResolve(rows ?? []);
        try {
          db.detach(() => {
          });
        } catch {
        }
      });
    });
  });
  return Promise.race([
    inner,
    new Promise(
      (_, reject) => setTimeout(() => reject(new Error(`firebird timeout (${TIMEOUT_MS}ms)`)), TIMEOUT_MS)
    )
  ]);
}
var SQL = `
  SELECT FIRST ? p.CODIGO,
         p.CODIGOPEDIDO,
         p.VALOR,
         p.PERCENTUALTAXA,
         p.DATAPAGAMENTO,
         p.DATACREDITO,
         p.NSUTRANSACAO,
         p.NUMEROAUTORIZACAOCARTAO,
         p.BANDEIRAMFE,
         p.ADQUIRENTEMFE,
         p.NROPARCELA,
         p.CODIGOCREDENCIADORACARTAO,
         p.CODIGOCONTACORRENTE,
         TRIM(fp.DESCRICAO) AS FORMA
  FROM PAGAMENTOS p
  LEFT JOIN FORMASPAGAMENTO fp ON fp.CODIGO = p.CODIGOFORMAPAGAMENTO
  WHERE p.DATADELETE IS NULL
    AND p.CODIGO > ?
  ORDER BY p.CODIGO
`;
var TIMEOUT_MS = 6e4;
var toIso = (d) => d ? d.toISOString() : null;
var toStr = (v) => v == null ? null : String(v).trim() || null;
var toNum = (v) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
var cacheColunas = /* @__PURE__ */ new Map();
async function colunasExistentes(cfg, tabela, pedidas) {
  const tabUpper = tabela.toUpperCase();
  let cache = cacheColunas.get(tabUpper);
  if (!cache) {
    try {
      const rows = await executarQuery(
        cfg,
        `SELECT TRIM(RDB$FIELD_NAME) AS NOME
         FROM RDB$RELATION_FIELDS
         WHERE RDB$RELATION_NAME = ?`,
        [tabUpper]
      );
      cache = new Set(rows.map((r) => String(r.NOME).trim().toUpperCase()));
    } catch {
      cache = /* @__PURE__ */ new Set();
    }
    cacheColunas.set(tabUpper, cache);
  }
  const set = /* @__PURE__ */ new Set();
  for (const c of pedidas) {
    if (cache.has(c.toUpperCase())) set.add(c.toUpperCase());
  }
  return set;
}
async function selectFlexivel(cfg, tabela, colunas, whereOrderLimit, params) {
  const existem = await colunasExistentes(cfg, tabela, colunas);
  if (existem.size === 0) {
    return [];
  }
  const proj = colunas.map((c) => existem.has(c.toUpperCase()) ? c : `NULL AS ${c}`).join(", ");
  const sql = `SELECT ${proj} FROM ${tabela} ${whereOrderLimit}`;
  return executarQuery(cfg, sql, params);
}
async function buscarFornecedores(cfg, desdeCodigo, limite) {
  const sql = `
    SELECT FIRST ? CODIGO, CNPJOUCPF, NOME, RAZAOSOCIAL, ENDERECO,
           NUMERO, COMPLEMENTO, BAIRRO, CIDADE, UF, CEP, EMAIL,
           FONEPRINCIPAL, FONESECUNDARIO, RGOUIE, DATADELETE, VERSAOREG
    FROM FORNECEDORES WHERE CODIGO > ? ORDER BY CODIGO
  `;
  const rows = await executarQuery(cfg, sql, [limite, desdeCodigo]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    cnpjOuCpf: toStr(r.CNPJOUCPF),
    nome: toStr(r.NOME),
    razaoSocial: toStr(r.RAZAOSOCIAL),
    endereco: toStr(r.ENDERECO),
    numero: toStr(r.NUMERO),
    complemento: toStr(r.COMPLEMENTO),
    bairro: toStr(r.BAIRRO),
    cidade: toStr(r.CIDADE),
    uf: toStr(r.UF),
    cep: toStr(r.CEP),
    email: toStr(r.EMAIL),
    fonePrincipal: toStr(r.FONEPRINCIPAL),
    foneSecundario: toStr(r.FONESECUNDARIO),
    rgOuIe: toStr(r.RGOUIE),
    dataDelete: toIso(r.DATADELETE),
    versaoReg: toNum(r.VERSAOREG)
  }));
}
async function buscarCategoriasContas(cfg, desdeCodigo, limite) {
  const sql = `
    SELECT FIRST ? CODIGO, CODIGOPAI, CODIGOGRUPODRE,
           DESCRICAO, TIPO, EXCLUIDAEM, VERSAOREG
    FROM CATEGORIACONTAS WHERE CODIGO > ? ORDER BY CODIGO
  `;
  const rows = await executarQuery(cfg, sql, [limite, desdeCodigo]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    codigoPaiExterno: toNum(r.CODIGOPAI),
    codigoGrupoDreExterno: toNum(r.CODIGOGRUPODRE),
    descricao: toStr(r.DESCRICAO),
    tipo: toStr(r.TIPO),
    excluidaEm: toIso(r.EXCLUIDAEM),
    versaoReg: toNum(r.VERSAOREG)
  }));
}
async function buscarContasBancarias(cfg, desdeCodigo, limite) {
  const rows = await selectFlexivel(
    cfg,
    "CONTASBANCARIAS",
    ["CODIGO", "DESCRICAO", "BANCO", "AGENCIA", "CONTA", "DATADELETE", "VERSAOREG"],
    "WHERE CODIGO > ? ORDER BY CODIGO ROWS ?",
    [desdeCodigo, limite]
  );
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    descricao: toStr(r.DESCRICAO),
    banco: toStr(r.BANCO),
    agencia: toStr(r.AGENCIA),
    conta: toStr(r.CONTA),
    dataDelete: toIso(r.DATADELETE),
    versaoReg: toNum(r.VERSAOREG)
  }));
}
async function buscarContasPagar(cfg, desdeCodigo, limite) {
  const sql = `
    SELECT FIRST ? CODIGO, CODIGOCATEGORIACONTAS, CODIGOFORNECEDOR,
           CODIGOCONTABANCARIA, PARCELA, TOTALPARCELAS,
           DATAVENCIMENTO, VALOR, DATAPAGAMENTO, DESCONTOS,
           JUROSMULTA, VALORPAGO, CODIGOREFERENCIA, DATACADASTRO,
           VERSAOREG, DATADELETE, COMPETENCIA, DESCRICAO, OBSERVACAO
    FROM CONTASPAGAR WHERE CODIGO > ? ORDER BY CODIGO
  `;
  const rows = await executarQuery(cfg, sql, [limite, desdeCodigo]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    codigoFornecedorExterno: toNum(r.CODIGOFORNECEDOR),
    codigoCategoriaExterno: toNum(r.CODIGOCATEGORIACONTAS),
    codigoContaBancariaExterno: toNum(r.CODIGOCONTABANCARIA),
    parcela: toNum(r.PARCELA),
    totalParcelas: toNum(r.TOTALPARCELAS),
    dataVencimento: r.DATAVENCIMENTO ? r.DATAVENCIMENTO.toISOString().slice(0, 10) : "",
    valor: r.VALOR ?? 0,
    dataPagamento: r.DATAPAGAMENTO ? r.DATAPAGAMENTO.toISOString().slice(0, 10) : null,
    descontos: toNum(r.DESCONTOS),
    jurosMulta: toNum(r.JUROSMULTA),
    valorPago: toNum(r.VALORPAGO),
    codigoReferencia: toStr(r.CODIGOREFERENCIA),
    competencia: toStr(r.COMPETENCIA),
    descricao: toStr(r.DESCRICAO),
    observacao: toStr(r.OBSERVACAO),
    dataCadastro: toIso(r.DATACADASTRO),
    dataDelete: toIso(r.DATADELETE),
    versaoReg: toNum(r.VERSAOREG)
  }));
}
async function buscarClientesJanela(cfg, desdeCodigoNaJanela, limite) {
  const rows = await selectFlexivel(
    cfg,
    "CRMCLIENTE",
    [
      "CODIGO",
      "NOME",
      "NOMECLIENTE",
      "EMAIL",
      "CPFCNPJ",
      "CNPJCPF",
      "FONE",
      "TELEFONE",
      "CELULAR",
      "DATADELETE",
      "VERSAOREG"
    ],
    "WHERE CODIGO > ? ORDER BY CODIGO ROWS ?",
    [desdeCodigoNaJanela, limite]
  );
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    cpfOuCnpj: toStr(r.CPFCNPJ ?? r.CNPJCPF),
    nome: toStr(r.NOME ?? r.NOMECLIENTE),
    email: toStr(r.EMAIL),
    telefone: toStr(r.FONE ?? r.TELEFONE ?? r.CELULAR),
    dataDelete: toIso(r.DATADELETE),
    versaoReg: toNum(r.VERSAOREG)
  }));
}
async function buscarClientes(cfg, desdeCodigo, limite) {
  const rows = await selectFlexivel(
    cfg,
    "CRMCLIENTE",
    [
      "CODIGO",
      "NOME",
      "NOMECLIENTE",
      "EMAIL",
      "CPFCNPJ",
      "CNPJCPF",
      "FONE",
      "TELEFONE",
      "CELULAR",
      "DATADELETE",
      "VERSAOREG"
    ],
    "WHERE CODIGO > ? ORDER BY CODIGO ROWS ?",
    [desdeCodigo, limite]
  );
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    cpfOuCnpj: toStr(r.CPFCNPJ ?? r.CNPJCPF),
    nome: toStr(r.NOME ?? r.NOMECLIENTE),
    email: toStr(r.EMAIL),
    telefone: toStr(r.FONE ?? r.TELEFONE ?? r.CELULAR),
    dataDelete: toIso(r.DATADELETE),
    versaoReg: toNum(r.VERSAOREG)
  }));
}
async function buscarMovimentosContaCorrente(cfg, desdeCodigo, limite) {
  const sql = `
    SELECT FIRST ? CODIGO, CODIGOCLIENTE, CODIGOPEDIDO, DATAHORA,
           SALDOINICIAL, CREDITO, DEBITO, SALDOFINAL, CODIGOPAGAMENTO,
           CODIGOUSUARIO, CODIGOCONTAESTORNADA, OBSERVACAO, IMPORTADO,
           VERSAOREG
    FROM CONTACORRENTE WHERE CODIGO > ? ORDER BY CODIGO
  `;
  const rows = await executarQuery(cfg, sql, [limite, desdeCodigo]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    codigoClienteExterno: toNum(r.CODIGOCLIENTE),
    codigoPedidoExterno: toNum(r.CODIGOPEDIDO),
    dataHora: toIso(r.DATAHORA),
    saldoInicial: toNum(r.SALDOINICIAL),
    credito: toNum(r.CREDITO),
    debito: toNum(r.DEBITO),
    saldoFinal: toNum(r.SALDOFINAL),
    codigoPagamento: toNum(r.CODIGOPAGAMENTO),
    codigoUsuario: toNum(r.CODIGOUSUARIO),
    codigoContaEstornada: toNum(r.CODIGOCONTAESTORNADA),
    observacao: toStr(r.OBSERVACAO),
    importado: toStr(r.IMPORTADO),
    versaoReg: toNum(r.VERSAOREG)
  }));
}
var toBool = (v) => {
  if (v == null) return null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toUpperCase();
  if (s === "T" || s === "S" || s === "1" || s === "Y" || s === "TRUE") return true;
  if (s === "F" || s === "N" || s === "0" || s === "FALSE") return false;
  return null;
};
async function buscarProdutos(cfg, desdeCodigo, limite) {
  const sql = `
    SELECT FIRST ? p.CODIGO, p.NOME, p.DESCRICAO, p.CODIGOPERSONALIZADO, p.CODIGOETIQUETA,
           COALESCE(MAX(pd.PRECOVENDA), p.PRECOVENDA) AS PRECOVENDA,
           COALESCE(MIN(CASE WHEN pd.PRECOCUSTO > 0 THEN pd.PRECOCUSTO END), p.PRECOCUSTO) AS PRECOCUSTO,
           COALESCE(SUM(pd.ESTOQUEATUAL), p.ESTOQUEATUAL) AS ESTOQUEATUAL,
           COALESCE(SUM(pd.ESTOQUEMINIMO), p.ESTOQUEMINIMO) AS ESTOQUEMINIMO,
           COALESCE(MAX(pd.ESTOQUECONTROLADO), p.ESTOQUECONTROLADO) AS ESTOQUECONTROLADO,
           p.DESCONTINUADO, p.ITEMPORKG,
           p.CODIGOUNIDADECOMERCIAL, p.CODIGOPRODUTOTIPO, p.CODIGOCOZINHA,
           p.NCM, p.CFOP, p.CEST, p.VERSAOREG,
           MIN(pd.DATAPAUSADO) AS DATAPAUSADO
    FROM PRODUTOS p
    LEFT JOIN PRODUTODETALHE pd ON pd.CODIGOPRODUTO = p.CODIGO
    WHERE p.CODIGO > ?
    GROUP BY p.CODIGO, p.NOME, p.DESCRICAO, p.CODIGOPERSONALIZADO, p.CODIGOETIQUETA,
             p.PRECOVENDA, p.PRECOCUSTO, p.ESTOQUEATUAL, p.ESTOQUEMINIMO,
             p.ESTOQUECONTROLADO, p.DESCONTINUADO, p.ITEMPORKG,
             p.CODIGOUNIDADECOMERCIAL, p.CODIGOPRODUTOTIPO, p.CODIGOCOZINHA,
             p.NCM, p.CFOP, p.CEST, p.VERSAOREG
    ORDER BY p.CODIGO
  `;
  const rows = await executarQuery(cfg, sql, [limite, desdeCodigo]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    nome: toStr(r.NOME),
    descricao: toStr(r.DESCRICAO),
    codigoPersonalizado: toStr(r.CODIGOPERSONALIZADO),
    codigoEtiqueta: toStr(r.CODIGOETIQUETA),
    precoVenda: toNum(r.PRECOVENDA),
    precoCusto: toNum(r.PRECOCUSTO),
    estoqueAtual: toNum(r.ESTOQUEATUAL),
    estoqueMinimo: toNum(r.ESTOQUEMINIMO),
    estoqueControlado: toBool(r.ESTOQUECONTROLADO),
    descontinuado: toBool(r.DESCONTINUADO),
    itemPorKg: toBool(r.ITEMPORKG),
    codigoUnidadeComercial: toNum(r.CODIGOUNIDADECOMERCIAL),
    codigoProdutoTipo: toNum(r.CODIGOPRODUTOTIPO),
    codigoCozinha: toNum(r.CODIGOCOZINHA),
    ncm: toStr(r.NCM),
    cfop: toStr(r.CFOP),
    cest: toStr(r.CEST),
    versaoReg: toNum(r.VERSAOREG),
    dataPausado: r.DATAPAUSADO instanceof Date ? r.DATAPAUSADO.toISOString() : toStr(r.DATAPAUSADO)
  }));
}
async function buscarPedidos(cfg, desdeCodigo, limite) {
  const sql = `
    SELECT FIRST ? CODIGO, NUMERO, SENHA,
           CODIGOCONTATOCLIENTE, CODIGOCONTATOFIADO, NOME,
           CODIGOCOLABORADOR, CODIGOUSUARIOCRIADOR,
           DATAABERTURA, DATAFECHAMENTO,
           VALORTOTAL, VALORTOTALITENS, SUBTOTALPAGO,
           TOTALDESCONTO, PERCENTUALDESCONTO,
           TOTALACRESCIMO, TOTALSERVICO, PERCENTUALTAXASERVICO,
           VALORENTREGA, VALORTROCO, VALORIVA,
           QUANTIDADEPESSOAS, NOTAEMITIDA, TAG,
           CODIGOPEDIDOORIGEM, CODIGOCUPOM,
           DATADELETE, VERSAOREG
    FROM PEDIDOS WHERE CODIGO > ? ORDER BY CODIGO
  `;
  const rows = await executarQuery(cfg, sql, [limite, desdeCodigo]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    numero: toNum(r.NUMERO),
    senha: toStr(r.SENHA),
    codigoClienteContatoExterno: toNum(r.CODIGOCONTATOCLIENTE),
    codigoClienteFiadoExterno: toNum(r.CODIGOCONTATOFIADO),
    nomeCliente: toStr(r.NOME),
    codigoColaborador: toNum(r.CODIGOCOLABORADOR),
    codigoUsuarioCriador: toNum(r.CODIGOUSUARIOCRIADOR),
    dataAbertura: toIso(r.DATAABERTURA),
    dataFechamento: toIso(r.DATAFECHAMENTO),
    valorTotal: toNum(r.VALORTOTAL),
    valorTotalItens: toNum(r.VALORTOTALITENS),
    subtotalPago: toNum(r.SUBTOTALPAGO),
    totalDesconto: toNum(r.TOTALDESCONTO),
    percentualDesconto: toNum(r.PERCENTUALDESCONTO),
    totalAcrescimo: toNum(r.TOTALACRESCIMO),
    totalServico: toNum(r.TOTALSERVICO),
    percentualTaxaServico: toNum(r.PERCENTUALTAXASERVICO),
    valorEntrega: toNum(r.VALORENTREGA),
    valorTroco: toNum(r.VALORTROCO),
    valorIva: toNum(r.VALORIVA),
    quantidadePessoas: toNum(r.QUANTIDADEPESSOAS),
    notaEmitida: toBool(r.NOTAEMITIDA),
    tag: toStr(r.TAG),
    codigoPedidoOrigem: toNum(r.CODIGOPEDIDOORIGEM),
    codigoCupom: toNum(r.CODIGOCUPOM),
    dataDelete: toIso(r.DATADELETE),
    versaoReg: toNum(r.VERSAOREG)
  }));
}
async function buscarPedidosJanela(cfg, diasAtras, desdeCodigoNaJanela, limite) {
  const sql = `
    SELECT FIRST ? CODIGO, NUMERO, SENHA,
           CODIGOCONTATOCLIENTE, CODIGOCONTATOFIADO, NOME,
           CODIGOCOLABORADOR, CODIGOUSUARIOCRIADOR,
           DATAABERTURA, DATAFECHAMENTO,
           VALORTOTAL, VALORTOTALITENS, SUBTOTALPAGO,
           TOTALDESCONTO, PERCENTUALDESCONTO,
           TOTALACRESCIMO, TOTALSERVICO, PERCENTUALTAXASERVICO,
           VALORENTREGA, VALORTROCO, VALORIVA,
           QUANTIDADEPESSOAS, NOTAEMITIDA, TAG,
           CODIGOPEDIDOORIGEM, CODIGOCUPOM,
           DATADELETE, VERSAOREG
    FROM PEDIDOS
    WHERE DATAABERTURA >= DATEADD(? DAY TO CURRENT_TIMESTAMP)
      AND CODIGO > ?
    ORDER BY CODIGO
  `;
  const rows = await executarQuery(cfg, sql, [
    limite,
    -diasAtras,
    desdeCodigoNaJanela
  ]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    numero: toNum(r.NUMERO),
    senha: toStr(r.SENHA),
    codigoClienteContatoExterno: toNum(r.CODIGOCONTATOCLIENTE),
    codigoClienteFiadoExterno: toNum(r.CODIGOCONTATOFIADO),
    nomeCliente: toStr(r.NOME),
    codigoColaborador: toNum(r.CODIGOCOLABORADOR),
    codigoUsuarioCriador: toNum(r.CODIGOUSUARIOCRIADOR),
    dataAbertura: toIso(r.DATAABERTURA),
    dataFechamento: toIso(r.DATAFECHAMENTO),
    valorTotal: toNum(r.VALORTOTAL),
    valorTotalItens: toNum(r.VALORTOTALITENS),
    subtotalPago: toNum(r.SUBTOTALPAGO),
    totalDesconto: toNum(r.TOTALDESCONTO),
    percentualDesconto: toNum(r.PERCENTUALDESCONTO),
    totalAcrescimo: toNum(r.TOTALACRESCIMO),
    totalServico: toNum(r.TOTALSERVICO),
    percentualTaxaServico: toNum(r.PERCENTUALTAXASERVICO),
    valorEntrega: toNum(r.VALORENTREGA),
    valorTroco: toNum(r.VALORTROCO),
    valorIva: toNum(r.VALORIVA),
    quantidadePessoas: toNum(r.QUANTIDADEPESSOAS),
    notaEmitida: toBool(r.NOTAEMITIDA),
    tag: toStr(r.TAG),
    codigoPedidoOrigem: toNum(r.CODIGOPEDIDOORIGEM),
    codigoCupom: toNum(r.CODIGOCUPOM),
    dataDelete: toIso(r.DATADELETE),
    versaoReg: toNum(r.VERSAOREG)
  }));
}
async function buscarPedidoItens(cfg, desdeCodigo, limite) {
  const sql = `
    SELECT FIRST ? CODIGO, CODIGOPEDIDO, CODIGOPRODUTO, NOMEPRODUTO,
           QUANTIDADE, VALORUNITARIO, PRECOCUSTO,
           VALORITEM, VALORCOMPLEMENTO, VALORFILHO,
           VALORDESCONTO, VALORGORJETA, VALORTOTAL,
           CODIGOPAI, CODIGOITEMPEDIDOTIPO, CODIGOPAGAMENTO,
           CODIGOCOLABORADOR, DATAHORACADASTRO, DATADELETE,
           DETALHES, VERSAOREG
    FROM ITENSPEDIDO WHERE CODIGO > ? ORDER BY CODIGO
  `;
  const rows = await executarQuery(cfg, sql, [limite, desdeCodigo]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    codigoPedidoExterno: r.CODIGOPEDIDO,
    codigoProdutoExterno: toNum(r.CODIGOPRODUTO),
    nomeProduto: toStr(r.NOMEPRODUTO),
    quantidade: toNum(r.QUANTIDADE),
    valorUnitario: toNum(r.VALORUNITARIO),
    precoCusto: toNum(r.PRECOCUSTO),
    valorItem: toNum(r.VALORITEM),
    valorComplemento: toNum(r.VALORCOMPLEMENTO),
    valorFilho: toNum(r.VALORFILHO),
    valorDesconto: toNum(r.VALORDESCONTO),
    valorGorjeta: toNum(r.VALORGORJETA),
    valorTotal: toNum(r.VALORTOTAL),
    codigoPai: toNum(r.CODIGOPAI),
    codigoItemPedidoTipo: toNum(r.CODIGOITEMPEDIDOTIPO),
    codigoPagamento: toNum(r.CODIGOPAGAMENTO),
    codigoColaborador: toNum(r.CODIGOCOLABORADOR),
    dataHoraCadastro: toIso(r.DATAHORACADASTRO),
    dataDelete: toIso(r.DATADELETE),
    detalhes: toStr(r.DETALHES),
    versaoReg: toNum(r.VERSAOREG)
  }));
}
async function buscarPedidoItensJanela(cfg, diasAtras, desdeCodigoNaJanela, limite) {
  const sql = `
    SELECT FIRST ? i.CODIGO, i.CODIGOPEDIDO, i.CODIGOPRODUTO, i.NOMEPRODUTO,
           i.QUANTIDADE, i.VALORUNITARIO, i.PRECOCUSTO,
           i.VALORITEM, i.VALORCOMPLEMENTO, i.VALORFILHO,
           i.VALORDESCONTO, i.VALORGORJETA, i.VALORTOTAL,
           i.CODIGOPAI, i.CODIGOITEMPEDIDOTIPO, i.CODIGOPAGAMENTO,
           i.CODIGOCOLABORADOR, i.DATAHORACADASTRO, i.DATADELETE,
           i.DETALHES, i.VERSAOREG
    FROM ITENSPEDIDO i
    INNER JOIN PEDIDOS p ON p.CODIGO = i.CODIGOPEDIDO
    WHERE p.DATAABERTURA >= DATEADD(? DAY TO CURRENT_TIMESTAMP)
      AND i.CODIGO > ?
    ORDER BY i.CODIGO
  `;
  const rows = await executarQuery(cfg, sql, [
    limite,
    -diasAtras,
    desdeCodigoNaJanela
  ]);
  return rows.map((r) => ({
    codigoExterno: r.CODIGO,
    codigoPedidoExterno: r.CODIGOPEDIDO,
    codigoProdutoExterno: toNum(r.CODIGOPRODUTO),
    nomeProduto: toStr(r.NOMEPRODUTO),
    quantidade: toNum(r.QUANTIDADE),
    valorUnitario: toNum(r.VALORUNITARIO),
    precoCusto: toNum(r.PRECOCUSTO),
    valorItem: toNum(r.VALORITEM),
    valorComplemento: toNum(r.VALORCOMPLEMENTO),
    valorFilho: toNum(r.VALORFILHO),
    valorDesconto: toNum(r.VALORDESCONTO),
    valorGorjeta: toNum(r.VALORGORJETA),
    valorTotal: toNum(r.VALORTOTAL),
    codigoPai: toNum(r.CODIGOPAI),
    codigoItemPedidoTipo: toNum(r.CODIGOITEMPEDIDOTIPO),
    codigoPagamento: toNum(r.CODIGOPAGAMENTO),
    codigoColaborador: toNum(r.CODIGOCOLABORADOR),
    dataHoraCadastro: toIso(r.DATAHORACADASTRO),
    dataDelete: toIso(r.DATADELETE),
    detalhes: toStr(r.DETALHES),
    versaoReg: toNum(r.VERSAOREG)
  }));
}
function buscarPagamentos(cfg, desdeCodigo, limite) {
  const opts = {
    host: cfg.firebird.host,
    port: cfg.firebird.port,
    database: cfg.firebird.database,
    user: cfg.firebird.user,
    password: cfg.firebird.password,
    lowercase_keys: false,
    pageSize: 4096
  };
  const inner = new Promise((resolve5, reject) => {
    let resolved = false;
    const safeResolve = (v) => {
      if (resolved) return;
      resolved = true;
      resolve5(v);
    };
    const safeReject = (e) => {
      if (resolved) return;
      resolved = true;
      reject(e);
    };
    import_node_firebird.default.attach(opts, (err, db) => {
      if (err) return safeReject(err);
      db.query(SQL, [limite, desdeCodigo], (e, rows) => {
        if (e) {
          try {
            db.detach(() => {
            });
          } catch {
          }
          return safeReject(e);
        }
        const out = rows.map((r) => ({
          codigoExterno: r.CODIGO,
          codigoPedidoExterno: r.CODIGOPEDIDO,
          formaPagamento: r.FORMA,
          valor: r.VALOR ?? 0,
          percentualTaxa: r.PERCENTUALTAXA,
          dataPagamento: r.DATAPAGAMENTO ? r.DATAPAGAMENTO.toISOString() : null,
          dataCredito: r.DATACREDITO ? r.DATACREDITO.toISOString() : null,
          nsuTransacao: r.NSUTRANSACAO !== null ? String(r.NSUTRANSACAO) : null,
          numeroAutorizacaoCartao: r.NUMEROAUTORIZACAOCARTAO,
          bandeiraMfe: r.BANDEIRAMFE,
          adquirenteMfe: r.ADQUIRENTEMFE,
          nroParcela: r.NROPARCELA,
          codigoCredenciadoraCartao: r.CODIGOCREDENCIADORACARTAO,
          codigoContaCorrente: r.CODIGOCONTACORRENTE
        }));
        safeResolve(out);
        try {
          db.detach(() => {
          });
        } catch {
        }
      });
    });
  });
  return Promise.race([
    inner,
    new Promise(
      (_, reject) => setTimeout(() => reject(new Error(`firebird timeout (${TIMEOUT_MS}ms)`)), TIMEOUT_MS)
    )
  ]);
}

// src/ingest.ts
async function enviarBatch(cfg, pagamentos) {
  const url = `${cfg.api.url.replace(/\/$/, "")}/api/ingest`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.api.token}`
    },
    body: JSON.stringify({ pagamentos })
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${r.statusText} - ${txt.slice(0, 200)}`);
  }
  return await r.json();
}
async function enviarFinanceiro(cfg, batch) {
  const url = `${cfg.api.url.replace(/\/$/, "")}/api/ingest/financeiro`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.api.token}`
    },
    body: JSON.stringify(batch)
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${r.statusText} - ${txt.slice(0, 200)}`);
  }
  return await r.json();
}
async function enviarPdv(cfg, batch) {
  const url = `${cfg.api.url.replace(/\/$/, "")}/api/ingest/pdv`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.api.token}`
    },
    body: JSON.stringify(batch)
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${r.statusText} - ${txt.slice(0, 200)}`);
  }
  return await r.json();
}

// src/logger.ts
var import_node_fs3 = require("node:fs");
var import_node_path3 = require("node:path");
var LOG_DIR = (0, import_node_path3.resolve)(process.cwd(), "logs");
function ensureDir() {
  try {
    (0, import_node_fs3.mkdirSync)(LOG_DIR, { recursive: true });
  } catch {
  }
}
function logFile() {
  const d = /* @__PURE__ */ new Date();
  const dia = d.toISOString().slice(0, 10);
  return (0, import_node_path3.resolve)(LOG_DIR, `agente-${dia}.log`);
}
function write(level, msg, extra) {
  const line = `${(/* @__PURE__ */ new Date()).toISOString()} [${level}] ${msg}${extra !== void 0 ? " " + JSON.stringify(extra) : ""}`;
  console.log(line);
  ensureDir();
  try {
    (0, import_node_fs3.appendFileSync)(logFile(), line + "\n", "utf8");
  } catch {
  }
}
var log = {
  info: (msg, extra) => write("INFO", msg, extra),
  warn: (msg, extra) => write("WARN", msg, extra),
  error: (msg, extra) => write("ERROR", msg, extra)
};

// src/index.ts
function bootTrace(msg) {
  try {
    const dir = (0, import_node_path4.resolve)((0, import_node_path4.dirname)(process.execPath), "logs");
    (0, import_node_fs4.mkdirSync)(dir, { recursive: true });
    (0, import_node_fs4.appendFileSync)(
      (0, import_node_path4.resolve)(dir, "boot-trace.log"),
      `${(/* @__PURE__ */ new Date()).toISOString()} | cwd=${process.cwd()} | execPath=${process.execPath} | argv=${JSON.stringify(process.argv)} | ${msg}
`
    );
  } catch (e) {
    try {
      (0, import_node_fs4.mkdirSync)("C:\\concilia-agente\\logs", { recursive: true });
      (0, import_node_fs4.appendFileSync)(
        "C:\\concilia-agente\\logs\\boot-trace.log",
        `${(/* @__PURE__ */ new Date()).toISOString()} | FALLBACK | err=${e.message} | ${msg}
`
      );
    } catch {
    }
  }
}
bootTrace("BOOT 1 - antes de imports");
bootTrace("BOOT 2 - imports OK");
var AGENTE_VERSAO = "0.5.5";
process.on("uncaughtException", (err) => {
  if (err?.message?.includes("pluginName")) {
    log.warn("node-firebird pluginName bug ignorado (apos ciclo)", {
      msg: err.message
    });
    return;
  }
  log.error("uncaughtException \u2014 reiniciando processo em 1s", {
    msg: err.message,
    stack: err.stack
  });
  setTimeout(() => process.exit(1), 1e3);
});
process.on("unhandledRejection", (err) => {
  const msg = err?.message ?? String(err);
  if (msg.includes("pluginName")) {
    log.warn("node-firebird pluginName bug ignorado (rejection)", { msg });
    return;
  }
  log.error("unhandledRejection \u2014 reiniciando processo em 1s", {
    err: msg,
    stack: err?.stack
  });
  setTimeout(() => process.exit(1), 1e3);
});
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ciclo(cfg, checkpoint) {
  const cp = checkpoint.get();
  log.info("iniciando ciclo", { ultimoCodigo: cp.ultimoCodigo });
  let totalCiclo = 0;
  while (true) {
    const desde = checkpoint.get().ultimoCodigo;
    let pagamentos;
    try {
      pagamentos = await buscarPagamentos(cfg, desde, cfg.batchSize);
    } catch (e) {
      log.warn("falha em buscarPagamentos, abortando ciclo", {
        err: e.message,
        desde
      });
      return;
    }
    if (pagamentos.length === 0) {
      if (totalCiclo === 0) {
        await enviarBatch(cfg, []).catch((e) => {
          log.warn("heartbeat falhou", { err: e.message });
        });
      }
      log.info("nada novo", { totalCiclo });
      return;
    }
    log.info("enviando batch", { qtd: pagamentos.length, primeiro: pagamentos[0]?.codigoExterno });
    const resp = await enviarBatch(cfg, pagamentos);
    log.info("batch ok", resp);
    const novoUltimo = pagamentos.reduce(
      (m, p) => p.codigoExterno > m ? p.codigoExterno : m,
      desde
    );
    checkpoint.update(novoUltimo, pagamentos.length);
    totalCiclo += pagamentos.length;
    if (pagamentos.length < cfg.batchSize) {
      log.info("ciclo terminou", { totalCiclo, ultimoCodigo: novoUltimo });
      return;
    }
    await sleep(200);
    await new Promise((r) => setImmediate(r));
  }
}
async function cicloFinanceiro(cfg, checkpoint) {
  const limite = cfg.batchSize;
  const entidades = [
    {
      nome: "fornecedores",
      key: "fornecedores",
      fetch: () => buscarFornecedores(cfg, checkpoint.getUltimoCodigo("fornecedores"), limite)
    },
    {
      nome: "categorias",
      key: "categorias",
      fetch: () => buscarCategoriasContas(cfg, checkpoint.getUltimoCodigo("categorias"), limite)
    },
    {
      nome: "contasBancarias",
      key: "contasBancarias",
      fetch: () => buscarContasBancarias(cfg, checkpoint.getUltimoCodigo("contasBancarias"), limite)
    },
    {
      nome: "contasPagar",
      key: "contasPagar",
      fetch: () => buscarContasPagar(cfg, checkpoint.getUltimoCodigo("contasPagar"), limite)
    },
    {
      nome: "clientes",
      key: "clientes",
      fetch: () => buscarClientes(cfg, checkpoint.getUltimoCodigo("clientes"), limite)
    },
    {
      nome: "movimentosContaCorrente",
      key: "movimentosContaCorrente",
      fetch: () => buscarMovimentosContaCorrente(
        cfg,
        checkpoint.getUltimoCodigo("movimentosContaCorrente"),
        limite
      )
    }
  ];
  for (const ent of entidades) {
    try {
      for (; ; ) {
        const items = await ent.fetch();
        if (items.length === 0) break;
        const batch = { [ent.key]: items };
        await enviarFinanceiro(cfg, batch);
        const ultimoCodigo = items.reduce(
          (m, p) => p.codigoExterno > m ? p.codigoExterno : m,
          checkpoint.getUltimoCodigo(ent.nome)
        );
        checkpoint.updateEntidade(ent.nome, ultimoCodigo, items.length);
        log.info("financeiro batch ok", {
          entidade: ent.nome,
          qtd: items.length,
          ultimo: ultimoCodigo
        });
        if (items.length < limite) break;
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (e) {
      log.warn("financeiro falhou pra entidade, segue", {
        entidade: ent.nome,
        err: e.message
      });
    }
  }
}
async function cicloPdv(cfg, checkpoint) {
  const limite = cfg.batchSize;
  const entidades = [
    {
      nome: "produtos",
      key: "produtos",
      fetch: () => buscarProdutos(cfg, checkpoint.getUltimoCodigo("produtos"), limite)
    },
    {
      nome: "pedidos",
      key: "pedidos",
      fetch: () => buscarPedidos(cfg, checkpoint.getUltimoCodigo("pedidos"), limite)
    },
    {
      nome: "pedidoItens",
      key: "pedidoItens",
      fetch: () => buscarPedidoItens(cfg, checkpoint.getUltimoCodigo("pedidoItens"), limite)
    }
  ];
  for (const ent of entidades) {
    try {
      for (; ; ) {
        const items = await ent.fetch();
        if (items.length === 0) break;
        const batch = { [ent.key]: items };
        await enviarPdv(cfg, batch);
        const ultimoCodigo = items.reduce(
          (m, p) => p.codigoExterno > m ? p.codigoExterno : m,
          checkpoint.getUltimoCodigo(ent.nome)
        );
        checkpoint.updateEntidade(ent.nome, ultimoCodigo, items.length);
        log.info("pdv batch ok", {
          entidade: ent.nome,
          qtd: items.length,
          ultimo: ultimoCodigo
        });
        if (items.length < limite) break;
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (e) {
      log.warn("pdv falhou pra entidade, segue", {
        entidade: ent.nome,
        err: e.message
      });
    }
  }
}
async function cicloPdvRefetch(cfg) {
  const dias = cfg.refetchJanelaDias;
  if (dias <= 0) return;
  const limite = cfg.batchSize;
  log.info("iniciando refetch janela", { dias });
  try {
    let desde = 0;
    let totalPedidos = 0;
    for (; ; ) {
      const items = await buscarPedidosJanela(cfg, dias, desde, limite);
      if (items.length === 0) break;
      await enviarPdv(cfg, { pedidos: items });
      desde = items.reduce(
        (m, p) => p.codigoExterno > m ? p.codigoExterno : m,
        desde
      );
      totalPedidos += items.length;
      log.info("refetch pedidos batch", { qtd: items.length, ultimo: desde });
      if (items.length < limite) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    log.info("refetch pedidos ok", { dias, total: totalPedidos });
  } catch (e) {
    log.warn("refetch pedidos falhou", { err: e.message });
  }
  try {
    let desde = 0;
    let totalItens = 0;
    for (; ; ) {
      const items = await buscarPedidoItensJanela(cfg, dias, desde, limite);
      if (items.length === 0) break;
      await enviarPdv(cfg, { pedidoItens: items });
      desde = items.reduce(
        (m, p) => p.codigoExterno > m ? p.codigoExterno : m,
        desde
      );
      totalItens += items.length;
      log.info("refetch itens batch", { qtd: items.length, ultimo: desde });
      if (items.length < limite) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    log.info("refetch itens ok", { dias, total: totalItens });
  } catch (e) {
    log.warn("refetch itens falhou", { err: e.message });
  }
  try {
    let desde = 0;
    let totalClientes = 0;
    for (; ; ) {
      const items = await buscarClientesJanela(cfg, desde, limite);
      if (items.length === 0) break;
      await enviarFinanceiro(cfg, { clientes: items });
      desde = items.reduce(
        (m, p) => p.codigoExterno > m ? p.codigoExterno : m,
        desde
      );
      totalClientes += items.length;
      log.info("refetch clientes batch", { qtd: items.length, ultimo: desde });
      if (items.length < limite) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    log.info("refetch clientes ok", { total: totalClientes });
  } catch (e) {
    log.warn("refetch clientes falhou", { err: e.message });
  }
}
function comTimeout(p, ms, label) {
  return new Promise((resolve5, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms / 1e3}s em ${label}`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve5(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}
var CICLO_TIMEOUT_MS = 10 * 60 * 1e3;
async function main() {
  console.log(`[boot] concilia-agente v${AGENTE_VERSAO} iniciando...`);
  const cfg = loadConfig();
  log.info("agente iniciado", {
    versao: AGENTE_VERSAO,
    api: cfg.api.url,
    firebird: `${cfg.firebird.host}:${cfg.firebird.port}`,
    intervalo: `${cfg.intervalSeconds}s`
  });
  const checkpoint = new Checkpoint(cfg.checkpointFile);
  for (; ; ) {
    try {
      await comTimeout(ciclo(cfg, checkpoint), CICLO_TIMEOUT_MS, "ciclo pagamentos");
    } catch (e) {
      log.error("ciclo pagamentos falhou", { err: e.message });
      if (e.message?.includes("timeout")) {
        log.error("ciclo travou \u2014 reiniciando processo");
        setTimeout(() => process.exit(1), 1e3);
        return;
      }
    }
    try {
      await comTimeout(cicloFinanceiro(cfg, checkpoint), CICLO_TIMEOUT_MS, "ciclo financeiro");
    } catch (e) {
      log.error("ciclo financeiro falhou", { err: e.message });
      if (e.message?.includes("timeout")) {
        log.error("ciclo financeiro travou \u2014 reiniciando processo");
        setTimeout(() => process.exit(1), 1e3);
        return;
      }
    }
    try {
      await comTimeout(cicloPdv(cfg, checkpoint), CICLO_TIMEOUT_MS, "ciclo pdv");
    } catch (e) {
      log.error("ciclo pdv falhou", { err: e.message });
      if (e.message?.includes("timeout")) {
        log.error("ciclo pdv travou \u2014 reiniciando processo");
        setTimeout(() => process.exit(1), 1e3);
        return;
      }
    }
    try {
      await comTimeout(cicloPdvRefetch(cfg), CICLO_TIMEOUT_MS, "ciclo pdv refetch");
    } catch (e) {
      log.error("ciclo pdv refetch falhou", { err: e.message });
      if (e.message?.includes("timeout")) {
        log.error("ciclo pdv refetch travou \u2014 reiniciando processo");
        setTimeout(() => process.exit(1), 1e3);
        return;
      }
    }
    await new Promise((r) => setTimeout(r, cfg.intervalSeconds * 1e3));
  }
}
main().catch((e) => {
  log.error("fatal", { err: e.message });
  process.exit(1);
});
/*! Bundled license information:

long/umd/index.js:
  (**
   * @license
   * Copyright 2009 The Closure Library Authors
   * Copyright 2020 Daniel Wirtz / The long.js Authors.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *
   * SPDX-License-Identifier: Apache-2.0
   *)
*/
